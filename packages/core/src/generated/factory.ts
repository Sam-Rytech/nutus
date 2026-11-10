/* Generated from abi/nutus_factory_abi.json by scripts/gen-types.ts. Do not edit. */

/**
 * Who may call `file_payout` on a lane.
 *
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
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
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "Promise".
 *
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "CreateResult".
 */
export type Promise = unknown;
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "PromiseOrValueString".
 *
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "FtOnTransferResult".
 */
export type PromiseOrValueString = string;
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "GetCodeHashResult".
 */
export type GetCodeHashResult = string;
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "GetInstanceResult".
 */
export type GetInstanceResult = string | null;
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "InstanceAccountForResult".
 */
export type InstanceAccountForResult = string;
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "ListInstancesResult".
 */
export type ListInstancesResult = InstanceEntry[];

export interface NutusFactoryAbi {}
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "FactoryConfig".
 *
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "GetConfigResult".
 */
export interface FactoryConfig {
  dao_factories: string[];
  instance_code_hash: string;
  instance_storage: string;
  setup_tokens: string[];
}
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "InstanceEntry".
 */
export interface InstanceEntry {
  dao: string;
  instance: string;
}
/**
 * Lane as the DAO submits it. Optional fields take the defaults above.
 *
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
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
 * One rung of the track-record ladder: once a recipient has at least `min_paid_jobs` paid jobs, Small payouts up to `small_max` are allowed.
 *
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "RecordStep".
 */
export interface RecordStep {
  min_paid_jobs: number;
  small_max: string;
}
/**
 * Passed to the instance's `new` (by the factory) during setup.
 *
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
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
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "CreateArgs".
 */
export interface CreateArgs {
  config: SetupConfig;
}
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "FtOnTransferArgs".
 */
export interface FtOnTransferArgs {
  sender_id: string;
  amount: string;
  msg: string;
}
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "GetCodeHashArgs".
 */
export interface GetCodeHashArgs {}
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "GetConfigArgs".
 */
export interface GetConfigArgs {}
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "GetInstanceArgs".
 */
export interface GetInstanceArgs {
  dao: string;
}
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "InstanceAccountForArgs".
 */
export interface InstanceAccountForArgs {
  dao: string;
}
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "ListInstancesArgs".
 */
export interface ListInstancesArgs {
  from_index?: string | null;
  limit?: number | null;
}
/**
 * This interface was referenced by `NutusFactoryAbi`'s JSON-Schema
 * via the `definition` "NewArgs".
 */
export interface NewArgs {
  instance_code_hash: string;
  setup_tokens: string[];
  dao_factories: string[];
  instance_storage?: string | null;
}

/** Every public method of the factory contract. */
export interface FactoryMethods {
  create: { kind: "call"; payable: true; args: CreateArgs; result: Promise };
  ft_on_transfer: { kind: "call"; payable: false; args: FtOnTransferArgs; result: PromiseOrValueString };
  get_code_hash: { kind: "view"; payable: false; args: GetCodeHashArgs; result: GetCodeHashResult };
  get_config: { kind: "view"; payable: false; args: GetConfigArgs; result: FactoryConfig };
  get_instance: { kind: "view"; payable: false; args: GetInstanceArgs; result: GetInstanceResult };
  instance_account_for: { kind: "view"; payable: false; args: InstanceAccountForArgs; result: InstanceAccountForResult };
  list_instances: { kind: "view"; payable: false; args: ListInstancesArgs; result: ListInstancesResult };
  new: { kind: "call"; payable: false; args: NewArgs; result: void };
}
