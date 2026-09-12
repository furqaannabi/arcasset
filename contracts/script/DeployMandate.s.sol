// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {RepaymentMandate} from "../src/RepaymentMandate.sol";

/**
 * @title DeployMandate
 * @notice Replaces RepaymentMandate alone, leaving the other seven contracts
 * where they are.
 *
 * @dev Worth its own script because the alternative is expensive and
 * irreversible. `Deploy.s.sol` redeploys everything, and everything downstream
 * is wired with immutables — a fresh PartyRegistry means every verified human
 * verifies again, a fresh NoteFactory orphans every note already minted, and
 * the subgraph reindexes from a new start block. None of that is needed to
 * change how a repayment is authorised.
 *
 * RepaymentMandate is the only contract in the set nothing else holds a
 * reference to. It reads the factory and the vault; neither reads it back, and
 * `RepaymentVault.repay` is permissionless, so a new mandate simply starts
 * working and the old one simply stops being used. Mandates already lodged
 * against the old address keep pointing at it — see docs/09-mandate.md.
 */
contract DeployMandate is Script {
    using stdJson for string;

    function run() external {
        string memory path =
            string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        string memory existing = vm.readFile(path);

        NoteFactory factory = NoteFactory(existing.readAddress(".NoteFactory"));
        RepaymentVault vault = RepaymentVault(payable(existing.readAddress(".RepaymentVault")));
        address previous = existing.readAddress(".RepaymentMandate");

        // The pair the new mandate will drive. Read rather than passed in, so
        // this cannot be pointed at a set it was not deployed against.
        console.log("chainId        ", block.chainid);
        console.log("NoteFactory    ", address(factory));
        console.log("RepaymentVault ", address(vault));
        console.log("replacing      ", previous);

        vm.startBroadcast();
        RepaymentMandate mandate = new RepaymentMandate(factory, vault);
        vm.stopBroadcast();

        console.log("RepaymentMandate", address(mandate));

        // Rewrite only this key. Reading the file back and re-serialising every
        // field would risk dropping one; string surgery on a known-shaped key
        // touches exactly what it says it touches.
        string memory updated = vm.replace(
            existing, vm.toString(previous), vm.toString(address(mandate))
        );
        vm.writeFile(path, updated);
        console.log("deployments/<chainId>.json updated");
    }
}
