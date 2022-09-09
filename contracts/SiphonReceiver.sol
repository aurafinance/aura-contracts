// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { ERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

/**
 * @title SiphonReciever
 * @dev Takes rAURA deposits from rAURA on L1 and distributes them
 *      When rewardClaimed is called on the Booster
 */
contract SiphonReceiver {
    function queueRAura(uint256) external {
        // TODO:
        // Only callable from the L1 (via lzEndpoint)
        // Mint rAURA to address(this)
        //
    }

    function mint(address, uint256) external {
        // TODO: transfer rAura to caller
        // Only callable by the Boosters rewardClaimed
    }

    function queueNewRewards(uint256) external {
        // TODO:
        // Potential idea:
        // only callable by the Booster
        // Every 2nd call could trigger the incentives to be
        // sent back to the L1 (via lzEndpoint)
    }

    function convert(uint256 _amount, bool _lock) external {
        // TODO:
        // Calls L1 SiphonDepositor convert function (via lzEndpoint)
    }
}
