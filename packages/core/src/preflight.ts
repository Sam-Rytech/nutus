// Preflight: check a payment proposal before the council votes on it, and fix
// what can be fixed inside the proposal. The causes come from the mainnet
// scan's "approved but failed" class (F4): the commonest is a recipient who
// isn't registered with the token, which fails at execution after the vote.

import { action, FT_STORAGE_DEPOSIT } from "./builders.ts";
import type { View } from "./rpc.ts";
import type { ProposalInput } from "./sputnik.ts";

export interface PreflightIssue {
  code: "RECIPIENT_NOT_REGISTERED" | "DAO_NOT_REGISTERED" | "INSUFFICIENT_TOKEN" | "INSUFFICIENT_NEAR" | "RECIPIENT_MISSING" | "UNKNOWN_TOKEN";
  message: string;
  /** Fixed inside the returned proposal (true) or needs a person (false). */
  fixed: boolean;
}

export interface PreflightResult {
  ok: boolean;
  issues: PreflightIssue[];
  /** The proposal to file: the original, or a fixed FunctionCall bundle. */
  proposal: ProposalInput;
}

export interface PreflightEnv {
  view: View;
  /** NEAR balance in yocto, or null if the account doesn't exist. */
  nearBalance: (accountId: string) => Promise<bigint | null>;
}

/**
 * Checks a Sputnik `Transfer` proposal from `dao`. Token transfers to an
 * unregistered recipient are rewritten as one FunctionCall on the token:
 * `storage_deposit` then `ft_transfer`, so approval can't strand the payment.
 * Other proposal kinds pass through unchecked.
 */
export async function preflight(env: PreflightEnv, dao: string, proposal: ProposalInput): Promise<PreflightResult> {
  const kind = proposal.kind as { Transfer?: { token_id: string; receiver_id: string; amount: string; msg: string | null } };
  if (!kind.Transfer) return { ok: true, issues: [], proposal };
  const { token_id: token, receiver_id: to, amount } = kind.Transfer;
  const issues: PreflightIssue[] = [];
  let out = proposal;

  if (token === "") {
    const [daoNear, recipient] = await Promise.all([env.nearBalance(dao), env.nearBalance(to)]);
    if (recipient === null && !/^[0-9a-f]{64}$/.test(to)) {
      issues.push({ code: "RECIPIENT_MISSING", fixed: false, message: `${to} doesn't exist; a NEAR transfer to it will fail.` });
    }
    if (daoNear !== null && daoNear < BigInt(amount)) {
      issues.push({ code: "INSUFFICIENT_NEAR", fixed: false, message: `The DAO holds less NEAR than this payment.` });
    }
    return { ok: issues.every((i) => i.fixed), issues, proposal: out };
  }

  let recipientReg: unknown, daoReg: unknown, daoBal: string;
  try {
    [recipientReg, daoReg, daoBal] = await Promise.all([
      env.view<unknown>(token, "storage_balance_of", { account_id: to }),
      env.view<unknown>(token, "storage_balance_of", { account_id: dao }),
      env.view<string>(token, "ft_balance_of", { account_id: dao }),
    ]);
  } catch {
    issues.push({ code: "UNKNOWN_TOKEN", fixed: false, message: `${token} didn't answer as an NEP-141 token.` });
    return { ok: false, issues, proposal };
  }

  if (daoReg === null) {
    issues.push({ code: "DAO_NOT_REGISTERED", fixed: false, message: `The DAO isn't registered with ${token}, so it holds none of it.` });
  }
  if (BigInt(daoBal) < BigInt(amount)) {
    issues.push({ code: "INSUFFICIENT_TOKEN", fixed: false, message: `The DAO holds ${daoBal} of ${token}; this payment needs ${amount}.` });
  }
  if (recipientReg === null) {
    issues.push({
      code: "RECIPIENT_NOT_REGISTERED",
      fixed: true,
      message: `${to} isn't registered with ${token}. Added a registration step so the payment can't fail after the vote.`,
    });
    out = {
      description: proposal.description,
      kind: {
        FunctionCall: {
          receiver_id: token,
          actions: [
            action("storage_deposit", { account_id: to, registration_only: true }, FT_STORAGE_DEPOSIT, 10),
            action("ft_transfer", { receiver_id: to, amount, memo: null }, 1, 20),
          ],
        },
      },
    };
  }
  return { ok: issues.every((i) => i.fixed), issues, proposal: out };
}
