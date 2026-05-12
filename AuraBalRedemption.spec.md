# AuraBalRedemption — Contract C

**Stage 2 exit for auraBAL holders.** auraBAL is burned for a pro-rata share of 90% of the BAL + WETH released from the veBAL lock. No receipt token is minted; this is terminal.

## Role

-   Deployed at Stage 0.
-   Funded in Stage 2 with 90% of BAL + WETH after the 80/20 BPT is exited.
-   Opened by `finalize()`.

## Design choice — denominator

`REDEEMABLE_AURABAL_SUPPLY` is **snapshotted at `finalize` from `auraBal.totalSupply()`**. Whoever holds auraBAL at `finalize` time divides the full basket. The protocol should burn or move its own auraBAL holdings (treasury, compounder fees, locker yield buffers that won't redeem) **before `finalize`** so they don't claim a slice that then becomes un-redeemable dust.

## State

-   `auraBal` (immutable IERC20)
-   `SWEEP_DELAY` (immutable uint256) — seconds after `finalize` before `sweep` unlocks.
-   `REDEEMABLE_AURABAL_SUPPLY` (uint256) — snapshot, set at `finalize`.
-   `sweepAfter` (uint256) — set at `finalize` to `block.timestamp + SWEEP_DELAY`.
-   `redeemableTokens[]`, `redeemableTokenAllocation[t]` — set at `finalize`.
-   `finalized` (bool)
-   `owner` (address)

## Constructor

`(address auraBal, uint256 sweepDelay, address owner)`

## External functions

| Function                           | Caller      | Behaviour                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finalize(address[] tokens)`       | owner, once | Requires contract is fully funded. Snapshots `auraBal.totalSupply()` into `REDEEMABLE_AURABAL_SUPPLY`. Snapshots current balances into `redeemableTokenAllocation`. Sets `sweepAfter = block.timestamp + SWEEP_DELAY`. Reverts on zero balance, duplicates, or `token == auraBal`. Sets `finalized = true`. |
| `redeem(uint256 amount)`           | anyone      | Requires `finalized && amount > 0`. `auraBal.safeTransferFrom(msg.sender, 0xdEaD, amount)`. For each token, sends `amount * allocation[t] / REDEEMABLE_AURABAL_SUPPLY`. nonReentrant.                                                                                                                       |
| `sweep(address token, address to)` | owner       | Requires `block.timestamp >= sweepAfter`. Sends full balance to `to`.                                                                                                                                                                                                                                       |
| `setOwner(address)`                | owner       | Rotate admin.                                                                                                                                                                                                                                                                                               |

## Events

`Finalized(uint256 snapshotSupply, address[] tokens, uint256[] allocations)`
`Redeemed(address user, uint256 auraBalBurned, uint256[] payouts)`
`Swept(address token, address to, uint256 amount)`
`OwnerSet(address newOwner)`

## Invariants

-   No receipt minted. `auraBal` sent to `0xdEaD` is terminal.
-   `sum of auraBAL burned ≤ REDEEMABLE_AURABAL_SUPPLY = auraBal.totalSupply() at finalize` ⇒ payouts never exceed funded basket.

## Decisions locked

-   Denominator = **snapshot of `auraBal.totalSupply()` at `finalize`**.
-   **No hard close on redemption** — redeem stays open until `sweep` drains the basket.
-   `sweepAfter = finalize timestamp + SWEEP_DELAY`; `SWEEP_DELAY` is an immutable constructor arg (suggest 365 days).
-   **Sidechain auraBAL policy:** bridge-home-or-forfeit. Stage 1 pauses L2 bridging. Users must bridge home before `finalize`. Un-bridged auraBAL remains locked in the OFT proxy on mainnet, is counted in `totalSupply()` at the snapshot, and its slice is paid to the OFT proxy → never redeemed → eventually swept as dust.

## Operational prerequisites before `finalize`

-   Protocol-owned auraBAL (treasury balances, compounder fees, locker yield streams) must be moved or burned so it doesn't consume a slice.
-   Compounder vault holders must exit to auraBAL first (compounder shares are not redeemable here).
-   L2 auraBAL holders must bridge home; any who don't forfeit their slice.
