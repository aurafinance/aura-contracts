# VoterProxy: Post-Shutdown veBAL Position Management

## Overview

The `VoterProxy` contract holds a locked veBAL position on Balancer's `VotingEscrow`. During normal operation, this position is managed by dedicated functions restricted to the `depositor` (CrvDepositor) and `operator` (Booster). Once the system is shut down, the generic `execute()` function on the VoterProxy becomes the mechanism for managing the locked position.

## The `execute()` Function

```solidity
function execute(
    address _to,
    uint256 _value,
    bytes calldata _data
) external returns (bool, bytes memory) {
    require(msg.sender == operator, "!auth");
    (bool success, bytes memory result) = _to.call{ value: _value }(_data);
    require(success, "!success");
    return (success, result);
}

```

This is an unrestricted arbitrary-call proxy gated solely by `msg.sender == operator`. It allows the operator to make any external call through the VoterProxy's identity, including direct interactions with the VotingEscrow contract.

## Shutdown and Operator Replacement

The process to gain `execute()` access post-shutdown follows a specific sequence:

1. **Shutdown the Booster** — The `BoosterOwner` (multisig) calls `shutdownSystem()`, which sets `isShutdown = true` on the Booster and withdraws all LP tokens from gauges. The `BoosterOwner` enforces that all pools must be individually shut down first (or a 30-day force-shutdown timer must expire).

2. **Set a new operator** — With the Booster shut down, the VoterProxy `owner` can call `setOperator()` to assign a new operator. This function enforces that the current operator must either be unset or report `isShutdown == true`:

    ```solidity
    require(operator == address(0) || IDeposit(operator).isShutdown() == true, "needs shutdown");
    ```

3. **Manage the position** — The new operator calls `execute()` on the VoterProxy, encoding calldata targeting the VotingEscrow to perform any required action.

## Available VotingEscrow Operations

Once a new operator is set, `execute()` can be used to call the VotingEscrow with any of its functions:

| Operation                       | Description                                                     |
| ------------------------------- | --------------------------------------------------------------- |
| `withdraw()`                    | Withdraw unlocked BPT after the lock expires                    |
| `increase_amount(uint256)`      | Add more BPT to the existing lock                               |
| `increase_unlock_time(uint256)` | Extend the lock duration                                        |
| `create_lock(uint256, uint256)` | Create a new lock after a previous one has been fully withdrawn |

Beyond the VotingEscrow, `execute()` can target any contract — gauge voting, fee claiming, governance participation, or token transfers — all performed as the VoterProxy.
