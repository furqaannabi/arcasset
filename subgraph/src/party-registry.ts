import { Bytes } from "@graphprotocol/graph-ts";
import { PartyVerified, PartyRevoked } from "../generated/PartyRegistry/PartyRegistry";
import { Originator, Borrower } from "../generated/schema";
import { ZERO_BI } from "./helpers";

/**
 * One human may originate on one note and borrow on another — we do not know
 * which at verification time — so a single PartyVerified creates both rows.
 * docs/03-subgraph.md.
 */
export function handlePartyVerified(event: PartyVerified): void {
  const party = event.params.party;
  const timestamp = event.params.timestamp;
  const nullifier = event.params.nullifier;

  let originator = Originator.load(party);
  if (originator == null) {
    originator = new Originator(party);
    originator.notesProposed = 0;
    originator.notesAccepted = 0;
    originator.notesMinted = 0;
    originator.proposalsRejected = 0;
    originator.proposalsExpired = 0;
    originator.notesMatured = 0;
    originator.notesDefaulted = 0;
    originator.principalRaised = ZERO_BI;
    originator.principalSold = ZERO_BI;
    originator.periodsSettled = 0;
    originator.periodsMissed = 0;
    originator.periodsCuredBySelf = 0;
  }
  originator.verifiedAt = timestamp;
  originator.nullifier = nullifier;
  originator.revoked = false;
  originator.revokedAt = null;
  originator.lastActivityAt = timestamp;
  originator.save();

  let borrower = Borrower.load(party);
  if (borrower == null) {
    borrower = new Borrower(party);
    borrower.notesAccepted = 0;
    borrower.notesMatured = 0;
    borrower.notesDefaulted = 0;
    borrower.principalOwed = ZERO_BI;
    borrower.principalRepaid = ZERO_BI;
    borrower.periodsSettled = 0;
    borrower.periodsMissed = 0;
    borrower.periodsCured = 0;
    borrower.totalDaysLate = ZERO_BI;
  }
  borrower.verifiedAt = timestamp;
  borrower.nullifier = nullifier;
  borrower.revoked = false;
  borrower.revokedAt = null;
  borrower.lastActivityAt = timestamp;
  borrower.save();
}

export function handlePartyRevoked(event: PartyRevoked): void {
  const party = event.params.party;
  const timestamp = event.params.timestamp;

  const originator = Originator.load(party);
  if (originator != null) {
    originator.revoked = true;
    originator.revokedAt = timestamp;
    originator.save();
  }

  const borrower = Borrower.load(party);
  if (borrower != null) {
    borrower.revoked = true;
    borrower.revokedAt = timestamp;
    borrower.save();
  }
}
