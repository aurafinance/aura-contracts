# AuraRedemption — Contract A

**Stage 0 entry.** AURA is burned in exchange for a 1:1 `rAURA` receipt token and a pro-rata share of the treasury basket.

## Role

-   Deployed at Stage 0, funded with the consolidated treasury basket (BAL, WETH, USDC, …).
-   Open from `finalize()` until `expiry`.
-   After `expiry`, unclaimed residual is swept to `RAuraRedemption`.

## State

-   `aura` (immutable IERC20) — AURA token.
-   `REDEEMABLE_AURA_SUPPLY` (immutable uint256) — pro-rata denominator. Total AURA supply minus protocol-owned / ineligible AURA.
-   `expiry` (immutable uint256) — redemption window close.
-   `redeemableTokens[]` — set once at `finalize`.
-   `redeemableTokenAllocation[token]` — per-token amount corresponding to a full `REDEEMABLE_AURA_SUPPLY` of burns. Set once at `finalize` by snapshotting the current balance.
-   `finalized` (bool)
-   `owner` — protocol multisig.

## Constructor

`(string name, string symbol, address aura, uint256 redeemableAuraSupply, uint256 expiry, address owner)`
Deploys as an ERC20 (the rAURA receipt). No redemption until `finalize`.

## External functions

| Function                           | Caller      | Behaviour                                                                                                                                                                                                                                         |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finalize(address[] tokens)`       | owner, once | Snapshots `IERC20(t).balanceOf(this)` into `redeemableTokenAllocation`. Reverts on zero balance, duplicates, or `token == aura`. Sets `finalized = true`. Must be called while contract is fully funded.                                          |
| `redeem(uint256 amount)`           | anyone      | Requires `finalized && block.timestamp < expiry && amount > 0`. `aura.safeTransferFrom(msg.sender, 0xdEaD, amount)`. For each token, sends `amount * allocation[t] / REDEEMABLE_AURA_SUPPLY`. `_mint(msg.sender, amount)` of rAURA. nonReentrant. |
| `sweep(address token, address to)` | owner       | Requires `block.timestamp >= expiry`. Sends full balance of `token` to `to` (target: `RAuraRedemption`).                                                                                                                                          |
| `setOwner(address)`                | owner       | Rotate admin.                                                                                                                                                                                                                                     |

## Events

`Finalized(address[] tokens, uint256[] allocations)`
`Redeemed(address user, uint256 auraBurned, uint256[] payouts)`
`Swept(address token, address to, uint256 amount)`
`OwnerSet(address newOwner)`

## Invariants

-   `sum of burns ≤ REDEEMABLE_AURA_SUPPLY` by construction of the AURA supply, so `amount * allocation / REDEEMABLE_AURA_SUPPLY` cannot over-distribute.
-   After `finalize`, allocations are immutable. New deposits into the contract sit as dust until `sweep`.
-   rAURA is transferable ERC20; its total supply is bounded above by the total AURA burned here.

## Decisions locked

-   rAURA is a **transferable** standard ERC20.
-   `finalize` is **strictly one-shot** — if funding is wrong, redeploy.
-   `expiry` is **strictly immutable** — set at deploy, no owner extension.
