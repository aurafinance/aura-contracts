// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

/**
 * @title   BridgeDelegateSender
 * @author  AuraFinance
 * @dev     Sends tokens to L1 via a bridge
 */
abstract contract BridgeDelegateSender is Ownable {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */
    /// @dev The crv token address
    address public crv;

    /// @dev The L1Receiver address
    address public l1Receiver;

    /// @dev The L2Coordinator address
    address public l2Coordinator;
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

    /**
     * @dev Emitted when the l2 coordinator address is updated.
     * @param l2Coordinator    The new l2 coordinator address.
     */
    event L2CoordinatorUpated(address l2Coordinator);

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
     * @notice Allows the owner of the contract to set the L2 coordinator address.
     * @dev  This function requires the owner of the contract to call it and pass in a valid address.
     * If the address is valid, the l2Coordinator variable is updated and an `L2CoordinatorUpated` event is emitted.
     * @param _l2Coordinator    The new l2 coordinator address.
     */
    function setL2Coordinator(address _l2Coordinator) external onlyOwner {
        require(_l2Coordinator != address(0), "!0");
        l2Coordinator = _l2Coordinator;
        emit L2CoordinatorUpated(_l2Coordinator);
    }

    /**
     * @dev Function to send a specified amount of tokens
     * @param _amount The amount of tokens to be sent
     */
    function send(uint256 _amount) external virtual;
}
