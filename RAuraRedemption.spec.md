# RAuraRedemption — Contract B

**Stage 2 exit for rAURA holders.** rAURA is burned for a pro-rata share of 10% of the BAL + WETH released from the veBAL lock, plus any residual treasury swept from `AuraRedemption`.

## Role

-   Deployed at Stage 0 so its address is known when `AuraRedemption` is deployed.
-   Funded in Stage 2: 10% of BAL + WETH after the 80/20 BPT is exited, plus residual treasury via `AuraRedemption.sweep(..., rAuraRedemption)`.
-   Opened by `finalize()` once funding is complete.

## Design choice — denominator

`REDEEMABLE_RAURA_SUPPLY` is **snapshotted at `finalize` from `rAura.totalSupply()`**. That is already the full set of rAURA that will ever exist because `AuraRedemption.expiry` precedes `finalize`. The full basket is distributed among the rAURA holders that turned up; nothing is reserved for never-minted rAURA.

## State

-   `rAura` (immutable IERC20) — the receipt minted by `AuraRedemption`.
-   `SWEEP_DELAY` (immutable uint256) — seconds after `finalize` before `sweep` unlocks (e.g. 365 days).
-   `REDEEMABLE_RAURA_SUPPLY` (uint256) — snapshot, set at `finalize`.
-   `sweepAfter` (uint256) — set at `finalize` to `block.timestamp + SWEEP_DELAY`.
-   `redeemableTokens[]`, `redeemableTokenAllocation[t]` — set at `finalize`.
-   `finalized` (bool)
-   `owner` (address)

## Constructor

`(address rAura, uint256 sweepDelay, address owner)`

## External functions

| Function                           | Caller      | Behaviour                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `finalize(address[] tokens)`       | owner, once | Requires `AuraRedemption.expiry` has passed (checked via its timestamp) and contract is fully funded. Snapshots `rAura.totalSupply()` into `REDEEMABLE_RAURA_SUPPLY`. Snapshots current balances into `redeemableTokenAllocation`. Sets `sweepAfter = block.timestamp + SWEEP_DELAY`. Reverts on zero balance, duplicates, or `token == rAura`. Sets `finalized = true`. |
| `redeem(uint256 amount)`           | anyone      | Requires `finalized && amount > 0`. `rAura.safeTransferFrom(msg.sender, 0xdEaD, amount)`. For each token, sends `amount * allocation[t] / REDEEMABLE_RAURA_SUPPLY`. nonReentrant.                                                                                                                                                                                        |
| `sweep(address token, address to)` | owner       | Requires `block.timestamp >= sweepAfter`. Sends full balance to `to`.                                                                                                                                                                                                                                                                                                    |
| `setOwner(address)`                | owner       | Rotate admin.                                                                                                                                                                                                                                                                                                                                                            |

## Events

`Finalized(uint256 snapshotSupply, address[] tokens, uint256[] allocations)`
`Redeemed(address user, uint256 rAuraBurned, uint256[] payouts)`
`Swept(address token, address to, uint256 amount)`
`OwnerSet(address newOwner)`

## Invariants

-   `sum of rAURA burned ≤ REDEEMABLE_RAURA_SUPPLY = rAura.totalSupply() at finalize` ⇒ payouts never exceed funded basket.
-   rAURA minted after `finalize` cannot redeem (no matching snapshot share). In practice this is zero because `AuraRedemption.expiry` has passed.
-   Does not mint any new token.

## Decisions locked

-   Denominator = **snapshot of `rAura.totalSupply()` at `finalize`**.
-   **No hard close on redemption** — redeem stays open until `sweep` drains the basket.
-   `sweepAfter = finalize timestamp + SWEEP_DELAY`; `SWEEP_DELAY` is an immutable constructor arg (suggest 365 days).
