# Smart Contract Audit Summary: DerolasStaking

**Contract:** `DerolasStaking`  
**Audit Focus:** Security, logic integrity, gas efficiency, and design consistency  
**Audit Result:** ✅ Passed with no critical or high-severity issues  
**Date:** May 2025

---

## ✅ Accepted Recommendations

| # | Category                        | Status   | Resolution Summary |
|---|--------------------------------|----------|---------------------|
| 1 | ReentrancyGuard                | ✅ Kept  | The custom `_locked` guard is equivalent to OpenZeppelin’s `ReentrancyGuard` and more gas-efficient. |
| 5 | Donation-based DoS resistance | ✅ Kept  | The `minDonations` threshold is sufficient to prevent spammy low-value donations. |
| 7 | Epoch storage cleanup         | ✅ Skipped | Storage scales linearly; no on-chain iteration or access cost growth. Historical cleanup is unnecessary. |

---

## ❌ Rejected or Non-Issues

| # | Category                             | Status    | Reason |
|----|-------------------------------------|-----------|--------|
| 2  | Fee-on-transfer ERC20 support       | ❌ Rejected | The contract is intentionally designed to accept only standard ERC20 tokens. Admin error to use fee-on-transfer is out-of-scope. |
| 3  | Permit2 `approve()` try/catch       | ❌ Rejected | Solidity handles `revert` bubbling correctly. Adding `try/catch` is unnecessary and bloats code. |
| 4  | Underflow in `getRemainingEpochLength()` | ❌ Rejected | After proper `if` checks, underflow cannot happen. The logic is sound and safe. |
| 6  | `SafeTransferLib` safety            | ❌ Rejected | The implementation uses audited [Solmate](https://github.com/transmissions11/solmate) library — known to be secure. |
| 7  | Emergency pause or kill-switch      | ❌ Rejected | Pausing violates the trust model. The contract is designed to be unstoppable once deployed. |
| 1′ | Uninitialized `epochPoints.endTime` | ❌ Rejected | Not initializing `endTime` is intentional. Epoch continues until `endEpoch()` is explicitly called. |

---

## 🔍 Additional Notes

- **Reentrancy:** Properly guarded with a simple binary lock.
- **DoS-resistance:** Ensured economically via donation minimums.
- **Fee-on-transfer tokens:** Explicitly unsupported by design.
- **Storage growth:** Linear and acceptable; no impact on performance.
- **Permissioning:** Properly restricted to `owner` where applicable.
- **External calls:** `BalancerRouter`, `Permit2`, and `Staking` integration is assumed stable and non-malicious.

---

## 🧩 Overall Assessment

The `DerolasStaking` contract is well-structured and economically sound. The contract aligns with its game-theoretic incentives and long-term staking/donation vision. There are no critical or high-severity findings.

---

## 📝 Recommendation

Publish a minimal note in the technical documentation that:

> The contract assumes `incentiveTokenAddress` is a standard ERC20 token (non-rebasing, no fee-on-transfer).

---

**Audit completed and validated by ChatGPT.**

