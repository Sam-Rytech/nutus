// View shapes the keeper reads, mirroring packages/core/abi/nutus_instance_abi.json.
// Amounts and times are decimal strings (U128 / U64).

export type PayoutStatus =
  | "Waiting"
  | "Sending"
  | "Paid"
  | "Cancelled"
  | { Escalating: { objected_by: string | null; reason: string | null } }
  | { Objected: { by: string; reason: string; needs_manual_filing: boolean } }
  | { Escalated: { proposal_id: string } }
  | { Settled: { proposal_id: string; approved: boolean } }
  | { Failed: { reason: string } };

export interface Payout {
  id: string;
  lane: string;
  recipient: string;
  token: string;
  amount: string;
  tier: "Small" | "Medium";
  deadline_ns: string;
  status: PayoutStatus;
}

export type StandingState =
  | "Active"
  | "Ended"
  | { Noticed: { notice_started_ns: string; remaining_periods: number } };

export interface Standing {
  id: string;
  amount: string;
  next_due_ns: string;
  ends_at_ns: string | null;
  buffer: string;
  sending: boolean;
  state: StandingState;
}

export interface InstanceConfig {
  dao: string;
  paused: boolean;
}

/** Sputnik proposal status, as returned by `get_proposal`. */
export type ProposalStatus =
  | "InProgress"
  | "Approved"
  | "Rejected"
  | "Removed"
  | "Expired"
  | "Moved"
  | "Failed";

export interface Snapshot {
  instance: string;
  config: InstanceConfig;
  payouts: Payout[];
  standing: Standing[];
  /** Status of each escalated payout's DAO proposal, by proposal id. */
  proposals: Map<string, ProposalStatus>;
}

export type ActionKind = "release" | "escalate" | "pay_due" | "settle_escalation";

export interface Action {
  kind: ActionKind;
  instance: string;
  /** Payout id or standing id. */
  id: string;
  /** Prepaid gas in TGas. */
  tgas: number;
  why: string;
}
