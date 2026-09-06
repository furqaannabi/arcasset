import { BigInt } from "@graphprotocol/graph-ts";
import {
  DelegationSet,
  DelegationRevoked,
  PeriodSettled,
  MarkedDelinquent,
  Defaulted,
} from "../generated/ServicingRelay/ServicingRelay";
import {
  Note,
  NoteIndex,
  Period,
  Agent,
  Originator,
  Borrower,
  ServicingAction,
} from "../generated/schema";
import { ZERO_BI, loadOrCreateProtocolDay, txLogId } from "./helpers";

/**
 * Note.status itself is set only by rwa-note.ts's StatusChanged handler,
 * which — within any transaction that also touches this relay — always fires
 * first: RWANote.markSettled/markMissed/markDefaulted change status and emit
 * before returning to the relay call that goes on to emit the event handled
 * here. Duplicating the transition here would just be two places computing
 * the same thing and risking drift.
 */

function loadNote(noteIdParam: BigInt): Note | null {
  const index = NoteIndex.load(noteIdParam.toString());
  if (index == null) return null;
  return Note.load(index.note);
}

export function handleDelegationSet(event: DelegationSet): void {
  const note = loadNote(event.params.noteId);
  if (note == null) return;
  note.agent = event.params.agent;
  note.save();

  let agent = Agent.load(event.params.agent);
  if (agent == null) {
    agent = new Agent(event.params.agent);
    agent.notesServiced = 0;
    agent.actionsTaken = 0;
    agent.feesEarned = ZERO_BI;
    agent.firstActiveAt = event.params.timestamp;
  }
  agent.notesServiced = agent.notesServiced + 1;
  agent.lastActiveAt = event.params.timestamp;
  agent.save();
}

export function handleDelegationRevoked(event: DelegationRevoked): void {
  const note = loadNote(event.params.noteId);
  if (note == null) return;
  note.agent = null;
  note.save();
}

export function handlePeriodSettled(event: PeriodSettled): void {
  const note = loadNote(event.params.noteId);
  if (note == null) return;

  const period = Period.load(note.id.concatI32(event.params.periodIndex));

  let wasCured = false;
  let lateness: BigInt = ZERO_BI;
  if (period != null) {
    wasCured = period.status == "Missed";
    if (wasCured) {
      period.status = "Cured";
    } else {
      period.status = "Settled";
    }
    if (event.params.timestamp.gt(period.end)) {
      lateness = event.params.timestamp.minus(period.end);
    }
    period.settledAt = event.params.timestamp;
    period.latenessSeconds = lateness;
    period.distributed = event.params.distributed;
    period.servicingFee = event.params.servicingFee;
    period.save();
  }

  note.periodsSettled = note.periodsSettled + 1;
  note.totalDistributed = note.totalDistributed.plus(event.params.distributed);
  note.servicingFeesPaid = note.servicingFeesPaid.plus(event.params.servicingFee);
  note.save();

  const originator = Originator.load(note.originator);
  if (originator != null) {
    originator.periodsSettled = originator.periodsSettled + 1;
    originator.lastActivityAt = event.params.timestamp;
    originator.save();
  }
  const borrower = Borrower.load(note.borrower);
  if (borrower != null) {
    borrower.periodsSettled = borrower.periodsSettled + 1;
    borrower.totalDaysLate = borrower.totalDaysLate.plus(lateness.div(BigInt.fromI32(86400)));
    if (wasCured) borrower.periodsCured = borrower.periodsCured + 1;
    borrower.lastActivityAt = event.params.timestamp;
    borrower.save();
  }

  const agent = Agent.load(event.transaction.from);
  if (agent != null) {
    agent.actionsTaken = agent.actionsTaken + 1;
    agent.feesEarned = agent.feesEarned.plus(event.params.servicingFee);
    agent.lastActiveAt = event.params.timestamp;
    agent.save();
  }

  const action = new ServicingAction(txLogId(event));
  action.note = note.id;
  action.agent = event.transaction.from;
  action.kind = "Settled";
  action.periodIndex = event.params.periodIndex;
  action.amount = event.params.distributed;
  action.timestamp = event.params.timestamp;
  action.txHash = event.transaction.hash;
  action.save();

  const day = loadOrCreateProtocolDay(event.params.timestamp);
  day.periodsSettled = day.periodsSettled + 1;
  day.save();
}

export function handleMarkedDelinquent(event: MarkedDelinquent): void {
  const note = loadNote(event.params.noteId);
  if (note == null) return;

  const period = Period.load(note.id.concatI32(event.params.periodIndex));
  if (period != null) {
    period.status = "Missed";
    period.save();
  }

  note.periodsMissed = note.periodsMissed + 1;
  note.save();

  const originator = Originator.load(note.originator);
  if (originator != null) {
    originator.periodsMissed = originator.periodsMissed + 1;
    originator.save();
  }
  const borrower = Borrower.load(note.borrower);
  if (borrower != null) {
    borrower.periodsMissed = borrower.periodsMissed + 1;
    borrower.save();
  }

  const agent = Agent.load(event.transaction.from);
  if (agent != null) {
    agent.actionsTaken = agent.actionsTaken + 1;
    agent.lastActiveAt = event.params.timestamp;
    agent.save();
  }

  const action = new ServicingAction(txLogId(event));
  action.note = note.id;
  action.agent = event.transaction.from;
  action.kind = "MarkedDelinquent";
  action.periodIndex = event.params.periodIndex;
  action.amount = event.params.shortfall;
  action.timestamp = event.params.timestamp;
  action.txHash = event.transaction.hash;
  action.save();

  const day = loadOrCreateProtocolDay(event.params.timestamp);
  day.periodsMissed = day.periodsMissed + 1;
  day.save();
}

export function handleDefaulted(event: Defaulted): void {
  const note = loadNote(event.params.noteId);
  if (note == null) return;

  const action = new ServicingAction(txLogId(event));
  action.note = note.id;
  action.agent = event.transaction.from;
  action.kind = "Defaulted";
  // periodIndex and amount stay unset — a default has none of either, and
  // leaving the field unset (not writing i32's 0-when-unset placeholder) is
  // what makes the GraphQL response come back null instead of a fake period 0.
  action.timestamp = event.params.timestamp;
  action.txHash = event.transaction.hash;
  action.save();
}
