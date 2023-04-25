// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { BridgeDelegateSender } from "./BridgeDelegateSender.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

/**
 * @title 	SimpleBridgeDelegateSender
 * @author  AuraFinance
 * @dev 	Only used as an example and for tests
 *  		Sends tokens to "L1" via a simple transfer
 */
contract SimpleBridgeDelegateSender is BridgeDelegateSender {
    using SafeERC20 for IERC20;

    address public immutable token;
    /**
     * @dev Emitted when tokens are sent to a recipient.
     * @param to The address of the recipient.
     * @param amount The amount of tokens sent.
     */
    event Send(address to, uint256 amount);

    /**
     * @dev Constructs the SimpleBridgeDelegateSender contract.
     * @param _token The address of the ERC20 token to be sent.
     */
    constructor(address _token) {
        token = _token;
    }

    /**
     * @dev Sends tokens to a recipient.
     * @param _to The address of the recipient.
     * @param _amount The amount of tokens to send.
     * Requirements:
     * - The caller must be the owner of the contract.
     */
    function send(address _to, uint256 _amount) external override onlyOwner {
        IERC20(token).safeTransfer(_to, _amount);
        emit Send(_to, _amount);
    }
}
