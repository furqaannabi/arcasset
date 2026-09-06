// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PartyRegistry} from "../src/PartyRegistry.sol";
import {IssuanceQueue} from "../src/IssuanceQueue.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {ServicingRelay} from "../src/ServicingRelay.sol";
import {Offering} from "../src/Offering.sol";
import {IPartyRegistry} from "../src/interfaces/IPartyRegistry.sol";
import {INoteFactory} from "../src/interfaces/INoteFactory.sol";
import {INoteRegistry} from "../src/interfaces/INoteRegistry.sol";
import {IPersonhoodVerifier} from "../src/interfaces/IPersonhoodVerifier.sol";
import {MockVerifier} from "./MockVerifier.sol";

/// @notice Deploys the whole set and wires it.
///
/// @dev The ordering is not arbitrary. NoteFactory takes the queue's address as
/// an immutable and IssuanceQueue takes the factory's, so one of them must be
/// predicted. The queue is deployed immediately after the factory and its
/// address computed from the deployer's nonce; the script asserts the
/// prediction held rather than trusting it, because a silent mismatch would
/// deploy a factory no queue can ever call.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address owner = vm.envOr("OWNER", deployer);
        address admin = vm.envOr("ADMIN", deployer);
        address verifierAddr = vm.envOr("VERIFIER", address(0));

        vm.startBroadcast(pk);

        if (verifierAddr == address(0)) {
            verifierAddr = address(new MockVerifier());
            console.log("WARNING: deployed MockVerifier. It proves nothing.");
        }

        PartyRegistry registry = new PartyRegistry(IPersonhoodVerifier(verifierAddr), owner);

        address predictedQueue = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        NoteFactory factory = new NoteFactory(predictedQueue, owner);
        IssuanceQueue queue = new IssuanceQueue(
            IPartyRegistry(address(registry)), INoteFactory(address(factory)), owner, admin
        );
        require(address(queue) == predictedQueue, "queue address prediction failed");

        RepaymentVault vault = new RepaymentVault(INoteRegistry(address(factory)), owner);
        ServicingRelay relay = new ServicingRelay(INoteRegistry(address(factory)), vault);
        Offering offering = new Offering(INoteRegistry(address(factory)));

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
        console.log("Verifier       ", verifierAddr);

        _write(
            address(registry),
            address(factory),
            address(queue),
            address(vault),
            address(relay),
            address(offering),
            verifierAddr
        );
    }

    /// @dev One JSON per network, read by backend and web. Nothing hardcodes an
    /// address anywhere else.
    function _write(
        address registry,
        address factory,
        address queue,
        address vault,
        address relay,
        address offering,
        address verifier
    ) private {
        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "PartyRegistry", registry);
        vm.serializeAddress(o, "NoteFactory", factory);
        vm.serializeAddress(o, "IssuanceQueue", queue);
        vm.serializeAddress(o, "RepaymentVault", vault);
        vm.serializeAddress(o, "ServicingRelay", relay);
        vm.serializeAddress(o, "Offering", offering);
        string memory json = vm.serializeAddress(o, "PersonhoodVerifier", verifier);

        string memory path =
            string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console.log("wrote", path);
    }
}
