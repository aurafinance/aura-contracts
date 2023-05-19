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

    /// @dev The ERC20 bridged token address.
    address public immutable token;

    /**
     * @dev Constructs the SimpleBridgeDelegateSender contract.
     * @param _token The address of the ERC20 token to be sent.
     */
    constructor(address _token) {
        token = _token;
    }

    /**
     * @dev Sends tokens to a l1Receiver.
     * @param _amount The amount of tokens to send.
     * Requirements:
     * - The caller must be the owner of the contract.
     */
    function send(uint256 _amount) external override onlyOwner {
        require(l1Receiver != address(0), "L1ReceiverNotSet");
        IERC20(token).safeTransfer(l1Receiver, _amount);
        emit Send(l1Receiver, _amount);
    }
}
