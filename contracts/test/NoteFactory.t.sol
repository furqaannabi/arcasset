// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RWANote} from "../src/RWANote.sol";
import {Terms} from "../src/Types.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract NoteFactoryTest is Test {
    NoteFactory factory;

    address owner = makeAddr("owner");
    address queue = makeAddr("queue");
    address relay = makeAddr("relay");
    address originator = makeAddr("originator");
    address borrower = makeAddr("borrower");
    address feeRecipient = makeAddr("feeRecipient");
    address stranger = makeAddr("stranger");

    bytes32 constant DOC = keccak256("manifest");

    function setUp() public {
        vm.warp(1_757_000_000);
        factory = new NoteFactory(queue, owner);
    }

    function _terms() internal view returns (Terms memory) {
        return Terms({
            borrower: borrower,
            principal: 100_000 ether,
            couponBps: 100,
            servicingFeeBps: 50,
            periodCount: 12,
            periodLength: 30 days,
            gracePeriod: 3 days,
            cureWindow: 30 days,
            acceptDeadline: uint64(block.timestamp + 2 days),
            feeRecipient: feeRecipient
        });
    }

    function _setRelay() internal {
        vm.prank(owner);
        factory.setRelay(relay);
    }

    function test_deploy_onlyQueue() public {
        _setRelay();
        vm.prank(stranger);
        vm.expectRevert(NoteFactory.NotQueue.selector);
        factory.deploy(1, originator, _terms(), DOC);
    }

    /// Better to refuse than to deploy a note nothing can ever settle.
    function test_deploy_revertsUntilRelayIsSet() public {
        vm.prank(queue);
        vm.expectRevert(NoteFactory.RelayNotSet.selector);
        factory.deploy(1, originator, _terms(), DOC);
    }

    function test_setRelay_onlyOwnerAndOnlyOnce() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        factory.setRelay(relay);

        _setRelay();
        assertEq(factory.relay(), relay);

        vm.prank(owner);
        vm.expectRevert(NoteFactory.RelayAlreadySet.selector);
        factory.setRelay(makeAddr("other relay"));
    }

    function test_deploy_producesAWorkingNote() public {
        _setRelay();
        vm.prank(queue);
        (uint256 noteId, address noteAddr) = factory.deploy(7, originator, _terms(), DOC);

        assertEq(noteId, 1);
        assertEq(factory.noteOf(1), noteAddr);
        assertEq(factory.noteCount(), 1);

        RWANote note = RWANote(payable(noteAddr));
        assertEq(note.totalSupply(), 100_000 ether);
        assertEq(note.balanceOf(originator), 100_000 ether);
        assertEq(note.originator(), originator);
        assertEq(note.borrower(), borrower);
        assertEq(note.distributor(), relay);
        assertEq(note.documentHash(), DOC);
    }

    /// The UI routes to the note before the transaction lands.
    function test_predictNote_matchesTheDeployedAddress() public {
        _setRelay();
        Terms memory t = _terms();
        address predicted = factory.predictNote(7, originator, t, DOC);

        vm.prank(queue);
        (, address actual) = factory.deploy(7, originator, t, DOC);
        assertEq(actual, predicted);
    }

    function test_deployTwiceForOneOriginator() public {
        _setRelay();
        vm.startPrank(queue);
        (, address a) = factory.deploy(1, originator, _terms(), DOC);
        (, address b) = factory.deploy(2, originator, _terms(), DOC);
        vm.stopPrank();
        assertTrue(a != b, "salt must include the proposal");
        assertEq(factory.noteCount(), 2);
    }
}
