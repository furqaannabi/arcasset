import { Address } from "@graphprotocol/graph-ts";
import {
  Proposed,
  Accepted,
  Approved,
  Rejected,
  Expired,
} from "../generated/IssuanceQueue/IssuanceQueue";
import { Proposal, Originator, Borrower } from "../generated/schema";
import { idFromBigInt } from "./helpers";

export function handleProposed(event: Proposed): void {
  const id = idFromBigInt(event.params.proposalId);

  const proposal = new Proposal(id);
  proposal.proposalId = event.params.proposalId;
  proposal.originator = event.params.originator;
  proposal.borrower = event.params.borrower;
  proposal.documentURI = event.params.documentURI;
  proposal.digest = event.params.digest;
  proposal.status = "Proposed";
  proposal.proposedAt = event.block.timestamp;
  proposal.proposedTx = event.transaction.hash;
  proposal.save();

  const originator = Originator.load(event.params.originator);
  if (originator != null) {
    originator.notesProposed = originator.notesProposed + 1;
    originator.lastActivityAt = event.block.timestamp;
    originator.save();
  }
}

export function handleAccepted(event: Accepted): void {
  const proposal = Proposal.load(idFromBigInt(event.params.proposalId));
  if (proposal == null) return;
  proposal.status = "Accepted";
  proposal.acceptedAt = event.params.timestamp;
  proposal.save();

  const borrower = Borrower.load(event.params.borrower);
  if (borrower != null) {
    borrower.notesAccepted = borrower.notesAccepted + 1;
    borrower.lastActivityAt = event.params.timestamp;
    borrower.save();
  }
}

export function handleApproved(event: Approved): void {
  const proposal = Proposal.load(idFromBigInt(event.params.proposalId));
  if (proposal == null) return;
  proposal.status = "Approved";
  proposal.approvedAt = event.params.timestamp;
  proposal.approvedBy = event.params.admin;
  proposal.digest = event.params.digest;
  proposal.save();
}

export function handleRejected(event: Rejected): void {
  const proposal = Proposal.load(idFromBigInt(event.params.proposalId));
  if (proposal == null) return;
  proposal.status = "Rejected";
  proposal.rejectedReason = event.params.reason;
  proposal.save();

  const originator = Originator.load(Address.fromBytes(proposal.originator));
  if (originator != null) {
    originator.proposalsRejected = originator.proposalsRejected + 1;
    originator.save();
  }
}

export function handleExpired(event: Expired): void {
  const proposal = Proposal.load(idFromBigInt(event.params.proposalId));
  if (proposal == null) return;
  proposal.status = "Expired";
  proposal.save();

  const originator = Originator.load(Address.fromBytes(proposal.originator));
  if (originator != null) {
    originator.proposalsExpired = originator.proposalsExpired + 1;
    originator.save();
  }
}
