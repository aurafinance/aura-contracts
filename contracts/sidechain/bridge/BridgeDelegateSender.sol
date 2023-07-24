// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { KeeperRole } from "../../peripheral/KeeperRole.sol";

/**
 * @title   BridgeDelegateSender
 * @author  AuraFinance
 * @dev     Sends tokens to L1 via a bridge
 */
abstract contract BridgeDelegateSender is KeeperRole {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */
    /// @dev The crv token address
    address public crv;

    /// @dev The L1Receiver address
    address public l1Receiver;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor() KeeperRole(msg.sender) {}

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */
    /**
     * @dev Emitted when tokens are sent to a recipient.
     * @param to The address of the recipient.
     * @param amount The amount of tokens sent.
     */
    event Send(address to, uint256 amount);

    /**
     * @dev Emitted when the l1 receiver address is updated.
     * @param l1Receiver    The new l1 receiver address.
     */
    event L1ReceiverUpated(address l1Receiver);

    /* -------------------------------------------------------------------
       Setter Functions
    ------------------------------------------------------------------- */
    /**
     * @notice Allows the owner of the contract to set the L1 receiver address.
     * @dev  This function requires the owner of the contract to call it and pass in a valid address.
     * If the address is valid, the l1Receiver variable is updated and an event is emitted.
     * @param _l1Receiver    The new l1 receiver address.
     */
    function setL1Receiver(address _l1Receiver) external onlyOwner {
        require(_l1Receiver != address(0), "!0");
        l1Receiver = _l1Receiver;
        emit L1ReceiverUpated(_l1Receiver);
    }

    /**
     * @dev Function to send a specified amount of tokens
     * @param _amount The amount of tokens to be sent
     */
    function send(uint256 _amount) external virtual;
}
