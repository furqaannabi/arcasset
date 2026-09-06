import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  StatusChanged,
  Transfer,
  Claimed,
  PaymentRecorded,
} from "../generated/templates/RWANote/RWANote";
import { Note, Position, Originator, Borrower, Period } from "../generated/schema";
import { ZERO_BI, ZERO_ADDRESS } from "./helpers";

const NOTE_STATUS = ["Active", "Delinquent", "Matured", "Defaulted"];

/**
 * The single source of truth for Note.status. Firing this event is the only
 * thing that changes it on-chain (RWANote._setStatus), so nothing else in
 * this subgraph sets the field directly — see servicing-relay.ts.
 */
export function handleStatusChanged(event: StatusChanged): void {
  const note = Note.load(event.address);
  if (note == null) return;

  const to = NOTE_STATUS[event.params.to];
  note.status = to;
  if (to == "Matured" || to == "Defaulted") {
    note.closedAt = event.params.timestamp;

    const originator = Originator.load(note.originator);
    if (originator != null) {
      if (to == "Matured") originator.notesMatured = originator.notesMatured + 1;
      else originator.notesDefaulted = originator.notesDefaulted + 1;
      originator.save();
    }
    const borrower = Borrower.load(note.borrower);
    if (borrower != null) {
      if (to == "Matured") borrower.notesMatured = borrower.notesMatured + 1;
      else borrower.notesDefaulted = borrower.notesDefaulted + 1;
      borrower.save();
    }
  }
  note.save();
}

export function handlePaymentRecorded(event: PaymentRecorded): void {
  const note = Note.load(event.address);
  if (note == null) return;

  const p = Period.load(note.id.concatI32(event.params.index));
  if (p == null) return;
  p.paid = event.params.periodPaid;
  p.save();
}

export function handleClaimed(event: Claimed): void {
  const note = Note.load(event.address);
  if (note == null) return;

  const position = Position.load(note.id.concat(event.params.holder));
  if (position == null) return;
  position.claimed = position.claimed.plus(event.params.amount);
  position.save();
}

/**
 * Authoritative balances. The mint's own Transfer (0x0 -> originator) is
 * never seen here — the note-factory.ts handler seeds it directly, since
 * this data source is not created until after NoteIssued (see there for why)
 * — so `from` below is always a real prior holder in practice.
 */
export function handleTransfer(event: Transfer): void {
  const note = Note.load(event.address);
  if (note == null) return;

  if (!event.params.from.equals(ZERO_ADDRESS)) {
    const fromId = note.id.concat(event.params.from);
    let from = Position.load(fromId);
    if (from == null) {
      from = new Position(fromId);
      from.note = note.id;
      from.holder = event.params.from;
      from.balance = ZERO_BI;
      from.bought = ZERO_BI;
      from.paid = ZERO_BI;
      from.claimed = ZERO_BI;
      from.firstHeldAt = event.block.timestamp;
    }
    from.balance = from.balance.minus(event.params.value);
    from.save();
  }

  const toId = note.id.concat(event.params.to);
  let to = Position.load(toId);
  if (to == null) {
    to = new Position(toId);
    to.note = note.id;
    to.holder = event.params.to;
    to.balance = ZERO_BI;
    to.bought = ZERO_BI;
    to.paid = ZERO_BI;
    to.claimed = ZERO_BI;
    to.firstHeldAt = event.block.timestamp;
  }
  to.balance = to.balance.plus(event.params.value);
  to.save();

  const originatorAddr = Address.fromBytes(note.originator);
  if (event.params.from.equals(originatorAddr) || event.params.to.equals(originatorAddr)) {
    const originatorPosition = Position.load(note.id.concat(originatorAddr));
    note.originatorRetained = originatorPosition == null ? ZERO_BI : originatorPosition.balance;
    note.save();
  }
}
