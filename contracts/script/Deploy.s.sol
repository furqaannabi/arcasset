// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PartyRegistry} from "../src/PartyRegistry.sol";
import {IssuanceQueue} from "../src/IssuanceQueue.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {ServicingRelay} from "../src/ServicingRelay.sol";
import {Offering} from "../src/Offering.sol";
import {RepaymentMandate} from "../src/RepaymentMandate.sol";
import {IPartyRegistry} from "../src/interfaces/IPartyRegistry.sol";
import {INoteFactory} from "../src/interfaces/INoteFactory.sol";
import {INoteRegistry} from "../src/interfaces/INoteRegistry.sol";
import {IPersonhoodVerifier} from "../src/interfaces/IPersonhoodVerifier.sol";
import {MockVerifier} from "./MockVerifier.sol";
import {AttestedVerifier} from "../src/verifiers/AttestedVerifier.sol";

/// @notice Deploys the whole set and wires it.
///
/// @dev The ordering is not arbitrary. NoteFactory takes the queue's address as
/// an immutable and IssuanceQueue takes the factory's, so one of them must be
/// predicted. The queue is deployed immediately after the factory and its
/// address computed from the deployer's nonce; the script asserts the
/// prediction held rather than trusting it, because a silent mismatch would
/// deploy a factory no queue can ever call.
contract Deploy is Script {
    /// @dev Storage, and named. Eight addresses passed positionally is one
    /// transposition away from a deployment record that points at the wrong
    /// contracts and still looks plausible; keeping them here also spares the
    /// stack, which eight live locals had already exhausted.
    struct Deployed {
        address registry;
        address factory;
        address queue;
        address vault;
        address relay;
        address offering;
        address verifier;
        address mandate;
    }

    Deployed private d;

    function run() external {
        // A keystore passed via --account/--keystore is picked up by forge
        // itself; DEPLOYER_PRIVATE_KEY is the fallback for local Anvil runs.
        uint256 pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        address deployer = pk == 0 ? msg.sender : vm.addr(pk);
        address owner = vm.envOr("OWNER", deployer);
        address admin = vm.envOr("ADMIN", deployer);
        address verifierAddr = vm.envOr("VERIFIER", address(0));

        if (pk == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(pk);
        }

        // Three ways to get a verifier, in descending order of how much the
        // chain is actually checking.
        //
        //   VERIFIER  — an address already deployed. Use it as given.
        //   ATTESTOR  — deploy AttestedVerifier trusting that signer. The
        //               shippable path on Arc, where there is no World ID
        //               Router, and weaker than on-chain proof verification.
        //   neither   — MockVerifier, which proves nothing and says so.
        address attestor = vm.envOr("ATTESTOR", address(0));
        if (verifierAddr == address(0) && attestor != address(0)) {
            verifierAddr = address(new AttestedVerifier(attestor));
            console.log("AttestedVerifier: personhood is asserted by", attestor);
            console.log("  a compromise of that key breaks the sybil defence entirely");
        }
        if (verifierAddr == address(0)) {
            verifierAddr = address(new MockVerifier());
            console.log("WARNING: deployed MockVerifier. It proves nothing.");
        }

        PartyRegistry registry = new PartyRegistry(IPersonhoodVerifier(verifierAddr), owner);

        address predictedQueue = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        NoteFactory factory = new NoteFactory(predictedQueue, owner);
        IssuanceQueue queue =
            new IssuanceQueue(IPartyRegistry(address(registry)), INoteFactory(address(factory)), owner, admin);
        require(address(queue) == predictedQueue, "queue address prediction failed");

        RepaymentVault vault = new RepaymentVault(INoteRegistry(address(factory)), owner);
        ServicingRelay relay = new ServicingRelay(INoteRegistry(address(factory)), vault);
        Offering offering = new Offering(INoteRegistry(address(factory)));
        RepaymentMandate mandate = new RepaymentMandate(factory, vault);

        factory.setInfrastructure(address(vault), address(relay));
        vault.setRelay(address(relay));

        vm.stopBroadcast();

        console.log("chainId        ", block.chainid);
        console.log("PartyRegistry  ", address(registry));
        console.log("NoteFactory    ", address(factory));
        console.log("IssuanceQueue  ", address(queue));
        console.log("RepaymentVault ", address(vault));
        console.log("ServicingRelay ", address(relay));
        console.log("Offering       ", address(offering));
        console.log("RepaymentMandate", address(mandate));
        console.log("Verifier       ", verifierAddr);
        console.log("Attestor       ", attestor);

        d.registry = address(registry);
        d.factory = address(factory);
        d.queue = address(queue);
        d.vault = address(vault);
        d.relay = address(relay);
        d.offering = address(offering);
        d.verifier = verifierAddr;
        d.mandate = address(mandate);
        _write();
    }

    /// @dev One JSON per network, read by backend and web. Nothing hardcodes an
    /// address anywhere else.
    function _write() private {
        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "PartyRegistry", d.registry);
        vm.serializeAddress(o, "NoteFactory", d.factory);
        vm.serializeAddress(o, "IssuanceQueue", d.queue);
        vm.serializeAddress(o, "RepaymentVault", d.vault);
        vm.serializeAddress(o, "ServicingRelay", d.relay);
        vm.serializeAddress(o, "Offering", d.offering);
        vm.serializeAddress(o, "RepaymentMandate", d.mandate);
        string memory json = vm.serializeAddress(o, "PersonhoodVerifier", d.verifier);

        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");

        // Refuse to clobber an existing record. A fork keeps the forked chain's
        // id, so a local test run against a fork of Arc writes to the same file
        // as the real deployment — which is exactly how the real testnet
        // addresses were once overwritten by a throwaway run.
        if (vm.exists(path) && !vm.envOr("ALLOW_OVERWRITE", false)) {
            console.log("refusing to overwrite", path);
            console.log("set ALLOW_OVERWRITE=true if you really mean to replace it");
            revert("deployment record exists");
        }
        vm.writeJson(json, path);
        console.log("wrote", path);
    }
}
