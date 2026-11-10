/* Generated from abi/nutus_instance_abi.json by scripts/gen-types.ts. Do not edit. */

/**
 * Who may call `file_payout` on a lane.
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "Filers".
 */
export type Filers =
  | "Anyone"
  | {
      Members: string[];
    }
  | {
      DaoMembersOfRole: string;
    };
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "PayoutStatus".
 */
export type PayoutStatus =
  | ("Paid" | "Cancelled")
  | "Waiting"
  | {
      Escalating: {
        objected_by?: string | null;
        reason?: string | null;
      };
    }
  | {
      Objected: {
        by: string;
        needs_manual_filing: boolean;
        reason: string;
      };
    }
  | {
      Escalated: {
        proposal_id: string;
      };
    }
  | {
      Settled: {
        approved: boolean;
        proposal_id: string;
      };
    }
  | "Sending"
  | {
      Failed: {
        reason: string;
      };
    };
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "Tier".
 */
export type Tier = "Small" | "Medium";
/**
 * Status without payload, used to filter `get_payouts`.
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "PayoutStatusKind".
 */
export type PayoutStatusKind =
  | "Waiting"
  | "Escalating"
  | "Objected"
  | "Escalated"
  | "Settled"
  | "Sending"
  | "Paid"
  | "Failed"
  | "Cancelled";
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "RoleKind".
 */
export type RoleKind =
  | "Everyone"
  | {
      Member: string;
    }
  | {
      Group: string[];
    };
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "Promise".
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "ApproveResult".
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "EscalateResult".
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "ObjectResult".
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "ReleaseResult".
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "SettleEscalationResult".
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "SyncCouncilResult".
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "WithdrawResult".
 */
export type Promise = unknown;
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "PromiseOrValueNull".
 */
export type PromiseOrValueNull = null;
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "PromiseOrValueString".
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "FtOnTransferResult".
 */
export type PromiseOrValueString = string;
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "ProposalStatus".
 */
export type ProposalStatus =
  "InProgress" | "Approved" | "Rejected" | "Removed" | "Expired" | "Moved" | "Failed";
/**
 * Where a record point came from. Every point traces to a real payment (I5).
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "SourceRef".
 */
export type SourceRef =
  | {
      DaoProposal: {
        id: string;
      };
    }
  | {
      NutusPayout: {
        id: string;
      };
    };
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "StandingState".
 */
export type StandingState =
  | ("Active" | "Ended")
  | {
      Noticed: {
        notice_started_ns: string;
        remaining_periods: number;
      };
    };
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "AddStandingResult".
 */
export type AddStandingResult = string;
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "FilePayoutResult".
 */
export type FilePayoutResult = string;
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetLaneResult".
 */
export type GetLaneResult = Lane | null;
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetLanesResult".
 */
export type GetLanesResult = Lane[];
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetPayoutResult".
 */
export type GetPayoutResult = Payout | null;
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetPayoutsResult".
 */
export type GetPayoutsResult = Payout[];
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetPeriodUsageResult".
 */
export type GetPeriodUsageResult = PeriodUsage | null;
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetRecordResult".
 */
export type GetRecordResult = Record | null;
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetStandingResult".
 */
export type GetStandingResult = Standing[];
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetTokenBooksResult".
 */
export type GetTokenBooksResult = TokenBookView[];

export interface NutusInstanceAbi {}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "ConfigView".
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetConfigResult".
 */
export interface ConfigView {
  /**
   * Spare NEAR right now: account balance − storage − NEAR budget − held deposits. Escalation needs this to be ≥ the DAO's proposal bond.
   */
  bond_float_available: string;
  /**
   * NEAR the DAO wants kept spare for escalation bonds (a warning threshold).
   */
  bond_float_target: string;
  council: string[];
  dao: string;
  factory: string;
  filing_deposit: string;
  next_payout_id: string;
  next_standing_id: string;
  objection_cooldown_ns: string;
  paused: boolean;
  version: string;
}
/**
 * A lane with defaults resolved and its period counters.
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "Lane".
 */
export interface Lane {
  filers: Filers;
  id: string;
  medium_max: string;
  medium_timeout_ns: string;
  name: string;
  objectors?: string[] | null;
  /**
   * Payouts not yet final (Waiting, Escalating, Objected, Sending). A lane can't be removed or change token while this is non-zero.
   */
  open_payouts: number;
  period_cap: string;
  period_ns: string;
  period_start_ns: string;
  record_steps: RecordStep[];
  silent_can_object: boolean;
  small_max: string;
  spent_this_period: string;
  token: string;
  window_ns: string;
}
/**
 * One rung of the track-record ladder: once a recipient has at least `min_paid_jobs` paid jobs, Small payouts up to `small_max` are allowed.
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "RecordStep".
 */
export interface RecordStep {
  min_paid_jobs: number;
  small_max: string;
}
/**
 * Lane as the DAO submits it. Optional fields take the defaults above.
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "LaneConfig".
 */
export interface LaneConfig {
  filers: Filers;
  id: string;
  /**
   * Medium: small_max < amount ≤ medium_max. Above → full DAO vote.
   */
  medium_max: string;
  medium_timeout_ns?: string | null;
  name: string;
  /**
   * `None` = the whole council may object / approve.
   */
  objectors?: string[] | null;
  /**
   * Total Small + Medium payouts allowed per period.
   */
  period_cap: string;
  period_ns?: string | null;
  /**
   * Track-record ladder for this lane. Empty = no record limit.
   */
  record_steps?: RecordStep[] | null;
  /**
   * Whether council seats flagged silent may still object. Default true.
   */
  silent_can_object?: boolean | null;
  /**
   * Small: amount ≤ small_max (and ≤ the recipient's record step).
   */
  small_max: string;
  token: string;
  window_ns?: string | null;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "Payout".
 */
export interface Payout {
  amount: string;
  approved_by?: string | null;
  /**
   * Small: end of the objection window. Medium: when `escalate` opens. Fixed at filing, so later lane changes can't move it.
   */
  deadline_ns: string;
  deposit: string;
  filed_at_ns: string;
  filer: string;
  id: string;
  lane: string;
  link: string;
  memo?: string | null;
  recipient: string;
  /**
   * When the payout entered `Sending`. After `STUCK_AFTER_NS` the DAO may resolve it with `resolve_stuck_payout` (lost callback).
   */
  sending_since_ns?: string | null;
  status: PayoutStatus;
  tier: Tier;
  token: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "PeriodUsage".
 */
export interface PeriodUsage {
  cap: string;
  lane: string;
  period_ns: string;
  period_start_ns: string;
  remaining: string;
  spent: string;
}
/**
 * Subset of `get_policy()`.
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "Policy".
 */
export interface Policy {
  proposal_bond: string;
  roles: RolePermission[];
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "RolePermission".
 */
export interface RolePermission {
  kind: RoleKind;
  name: string;
  /**
   * e.g. `"*:AddProposal"`, `"transfer:VoteApprove"`.
   */
  permissions: string[];
}
/**
 * Subset of `get_proposal(id)`. (Sputnik returns `id` as a bare JSON number, not a `U64` string; it isn't needed, so it isn't read.)
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "Proposal".
 */
export interface Proposal {
  status: ProposalStatus;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "Record".
 */
export interface Record {
  /**
   * `paid_jobs` when the last objection landed. During the cooldown the record step is computed from this, so step-ups pause.
   */
  jobs_at_last_objection: number;
  last_objection_ns?: string | null;
  paid_jobs: number;
  sources: SourceRef[];
}
/**
 * One entry of `seed_records`: past DAO proposals that paid this account.
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "SeedEntry".
 */
export interface SeedEntry {
  account: string;
  proposal_ids: string[];
}
/**
 * Passed to the instance's `new` (by the factory) during setup.
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "SetupConfig".
 */
export interface SetupConfig {
  /**
   * Initial council. `None` = read from the DAO policy on first `sync_council`.
   */
  council?: string[] | null;
  /**
   * Anti-spam deposit for `file_payout`, in yoctoNEAR.
   */
  filing_deposit?: string | null;
  lanes: LaneConfig[];
  objection_cooldown_ns?: string | null;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "Standing".
 */
export interface Standing {
  amount: string;
  /**
   * This payment's share of `TokenBook.standing_buffer`.
   */
  buffer: string;
  ends_at_ns?: string | null;
  id: string;
  /**
   * The `pay_due` transfer in flight, if any.
   */
  in_flight?: StandingTransfer | null;
  memo?: string | null;
  next_due_ns: string;
  /**
   * This payment's share of `TokenBook.committed_notice`.
   */
  notice_locked: string;
  notice_periods: number;
  period_ns: string;
  recipient: string;
  state: StandingState;
  token: string;
}
/**
 * A standing transfer awaiting its callback: what to settle either way.
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "StandingTransfer".
 */
export interface StandingTransfer {
  amount: string;
  from_notice: boolean;
  periods: number;
  prev_next_due_ns: string;
  since_ns: string;
}
/**
 * What the DAO passes to `add_standing`.
 *
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "StandingInput".
 */
export interface StandingInput {
  amount: string;
  ends_at_ns?: string | null;
  first_due_ns: string;
  memo?: string | null;
  /**
   * Periods of pay guaranteed after `stop_standing`. Locked on creation.
   */
  notice_periods: number;
  period_ns: string;
  recipient: string;
  token: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "TokenBookView".
 */
export interface TokenBookView {
  available: string;
  balance: string;
  committed_notice: string;
  reserved: string;
  standing_buffer: string;
  token: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "AddStandingArgs".
 */
export interface AddStandingArgs {
  standing: StandingInput;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "ApproveArgs".
 */
export interface ApproveArgs {
  payout_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "CancelPayoutArgs".
 */
export interface CancelPayoutArgs {
  payout_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "ConfigureLaneArgs".
 */
export interface ConfigureLaneArgs {
  lane: LaneConfig;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "EscalateArgs".
 */
export interface EscalateArgs {
  payout_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "FilePayoutArgs".
 */
export interface FilePayoutArgs {
  lane_id: string;
  recipient: string;
  amount: string;
  link: string;
  memo?: string | null;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "FtOnTransferArgs".
 */
export interface FtOnTransferArgs {
  sender_id: string;
  amount: string;
  msg: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "FundBondFloatArgs".
 */
export interface FundBondFloatArgs {}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "FundNearArgs".
 */
export interface FundNearArgs {}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "FundStandingNearArgs".
 */
export interface FundStandingNearArgs {
  standing_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetConfigArgs".
 */
export interface GetConfigArgs {}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetLaneArgs".
 */
export interface GetLaneArgs {
  lane_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetLanesArgs".
 */
export interface GetLanesArgs {}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetPayoutArgs".
 */
export interface GetPayoutArgs {
  payout_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetPayoutsArgs".
 */
export interface GetPayoutsArgs {
  from_index?: string | null;
  limit?: number | null;
  status?: PayoutStatusKind | null;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetPeriodUsageArgs".
 */
export interface GetPeriodUsageArgs {
  lane_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetRecordArgs".
 */
export interface GetRecordArgs {
  account_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetStandingArgs".
 */
export interface GetStandingArgs {
  from_index?: string | null;
  limit?: number | null;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "GetTokenBooksArgs".
 */
export interface GetTokenBooksArgs {}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "NewArgs".
 */
export interface NewArgs {
  dao: string;
  config: SetupConfig;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "ObjectArgs".
 */
export interface ObjectArgs {
  payout_id: string;
  reason: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "PauseArgs".
 */
export interface PauseArgs {}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "PayDueArgs".
 */
export interface PayDueArgs {
  standing_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "ReleaseArgs".
 */
export interface ReleaseArgs {
  payout_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "RemoveLaneArgs".
 */
export interface RemoveLaneArgs {
  lane_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "ResolveStuckPayoutArgs".
 */
export interface ResolveStuckPayoutArgs {
  payout_id: string;
  paid: boolean;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "ResolveStuckStandingArgs".
 */
export interface ResolveStuckStandingArgs {
  standing_id: string;
  paid: boolean;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "SeedRecordsArgs".
 */
export interface SeedRecordsArgs {
  entries: SeedEntry[];
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "SetBondFloatArgs".
 */
export interface SetBondFloatArgs {
  amount: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "SetFilingDepositArgs".
 */
export interface SetFilingDepositArgs {
  amount: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "SetRecordStepsArgs".
 */
export interface SetRecordStepsArgs {
  lane_id: string;
  steps: RecordStep[];
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "SettleEscalationArgs".
 */
export interface SettleEscalationArgs {
  payout_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "StopStandingArgs".
 */
export interface StopStandingArgs {
  standing_id: string;
}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "SyncCouncilArgs".
 */
export interface SyncCouncilArgs {}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "UnpauseArgs".
 */
export interface UnpauseArgs {}
/**
 * This interface was referenced by `NutusInstanceAbi`'s JSON-Schema
 * via the `definition` "WithdrawArgs".
 */
export interface WithdrawArgs {
  token: string;
  amount: string;
  to?: string | null;
}

/** Every public method of the instance contract. */
export interface InstanceMethods {
  add_standing: { kind: "call"; payable: false; args: AddStandingArgs; result: AddStandingResult };
  approve: { kind: "call"; payable: false; args: ApproveArgs; result: Promise };
  cancel_payout: { kind: "call"; payable: false; args: CancelPayoutArgs; result: void };
  configure_lane: { kind: "call"; payable: false; args: ConfigureLaneArgs; result: void };
  escalate: { kind: "call"; payable: false; args: EscalateArgs; result: Promise };
  file_payout: { kind: "call"; payable: true; args: FilePayoutArgs; result: FilePayoutResult };
  ft_on_transfer: { kind: "call"; payable: false; args: FtOnTransferArgs; result: PromiseOrValueString };
  fund_bond_float: { kind: "call"; payable: true; args: FundBondFloatArgs; result: void };
  fund_near: { kind: "call"; payable: true; args: FundNearArgs; result: void };
  fund_standing_near: { kind: "call"; payable: true; args: FundStandingNearArgs; result: void };
  get_config: { kind: "view"; payable: false; args: GetConfigArgs; result: ConfigView };
  get_lane: { kind: "view"; payable: false; args: GetLaneArgs; result: GetLaneResult };
  get_lanes: { kind: "view"; payable: false; args: GetLanesArgs; result: GetLanesResult };
  get_payout: { kind: "view"; payable: false; args: GetPayoutArgs; result: GetPayoutResult };
  get_payouts: { kind: "view"; payable: false; args: GetPayoutsArgs; result: GetPayoutsResult };
  get_period_usage: { kind: "view"; payable: false; args: GetPeriodUsageArgs; result: GetPeriodUsageResult };
  get_record: { kind: "view"; payable: false; args: GetRecordArgs; result: GetRecordResult };
  get_standing: { kind: "view"; payable: false; args: GetStandingArgs; result: GetStandingResult };
  get_token_books: { kind: "view"; payable: false; args: GetTokenBooksArgs; result: GetTokenBooksResult };
  new: { kind: "call"; payable: true; args: NewArgs; result: void };
  object: { kind: "call"; payable: false; args: ObjectArgs; result: Promise };
  pause: { kind: "call"; payable: false; args: PauseArgs; result: void };
  pay_due: { kind: "call"; payable: false; args: PayDueArgs; result: unknown };
  release: { kind: "call"; payable: false; args: ReleaseArgs; result: Promise };
  remove_lane: { kind: "call"; payable: false; args: RemoveLaneArgs; result: void };
  resolve_stuck_payout: { kind: "call"; payable: false; args: ResolveStuckPayoutArgs; result: void };
  resolve_stuck_standing: { kind: "call"; payable: false; args: ResolveStuckStandingArgs; result: void };
  seed_records: { kind: "call"; payable: false; args: SeedRecordsArgs; result: void };
  set_bond_float: { kind: "call"; payable: false; args: SetBondFloatArgs; result: void };
  set_filing_deposit: { kind: "call"; payable: false; args: SetFilingDepositArgs; result: void };
  set_record_steps: { kind: "call"; payable: false; args: SetRecordStepsArgs; result: void };
  settle_escalation: { kind: "call"; payable: false; args: SettleEscalationArgs; result: Promise };
  stop_standing: { kind: "call"; payable: false; args: StopStandingArgs; result: void };
  sync_council: { kind: "call"; payable: false; args: SyncCouncilArgs; result: Promise };
  unpause: { kind: "call"; payable: false; args: UnpauseArgs; result: void };
  withdraw: { kind: "call"; payable: false; args: WithdrawArgs; result: Promise };
}
