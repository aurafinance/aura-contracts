// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @title   Cross Chain Messages
 * @author  AuraFinance
 * @dev     Share types for cross chain messages
 */
library CrossChainMessages {
    /// @dev Magic Bytes to pad the custom message with
    /// bytes4(keccak256("_isCustomMessage(bytes)"))
    bytes4 public constant MAGIC_BYTES = 0x7a7f9946;

    enum MessageType {
        // Lock L2 AURA as vlAURA
        LOCK,
        // sent from the L2 to trigger a feeDebt update
        FEES,
        // sent from the L1 to the L2 after a successful debt update
        // will trigger AURA to be sent to the L2 and the rate to get
        // updated on the L2
        FEES_CALLBACK
    }

    function getMessageType(bytes memory _payload) internal pure returns (MessageType) {
        bytes32 messageType;
        assembly {
            messageType := mload(add(add(_payload, 32), 32))
        }
        return MessageType(uint8(uint256(messageType)));
    }

    function isCustomMessage(bytes memory _payload) internal pure returns (bool) {
        bytes4 sig;
        assembly {
            sig := mload(add(_payload, 32))
        }
        return sig == MAGIC_BYTES;
    }

    /* -------------------------------------------------------------------
       Encode
    ------------------------------------------------------------------- */

    /**
     * @notice This function encodes the lock message for the sender and amount.
     * @dev The function encodes the lock message for the sender and amount using the ABI encoding.
     * The MAGIC_BYTES and MessageType.LOCK are used to encode the message.
     */
    function encodeLock(address sender, uint256 amount) internal pure returns (bytes memory) {
        return abi.encode(MAGIC_BYTES, MessageType.LOCK, sender, amount);
    }

    /**
     * @notice This function encodes fees for a given amount.
     * @dev The function takes a uint256 amount as an argument and returns a bytes memory.
     */
    function encodeFees(uint256 amount) internal pure returns (bytes memory) {
        return abi.encode(MAGIC_BYTES, MessageType.FEES, amount);
    }

    /**
     * @notice encodeFeesCallback() is a function that encodes the cvxAmount into a bytes memory.
     * @dev The function takes a uint256 parameter cvxAmount, and returns a bytes memory.
     */
    function encodeFeesCallback(uint256 cvxAmount) internal pure returns (bytes memory) {
        return abi.encode(MAGIC_BYTES, MessageType.FEES_CALLBACK, cvxAmount);
    }

    /* -------------------------------------------------------------------
       Decode 
    ------------------------------------------------------------------- */

    /**
     * @notice decodeFeesCallback decodes the payload and returns the cvxAmount
     * @dev decodeFeesCallback takes in a bytes memory _payload and returns an uint256 cvxAmount
     */
    function decodeFeesCallback(bytes memory _payload) internal pure returns (uint256) {
        (, , uint256 cvxAmount) = abi.decode(_payload, (bytes4, uint8, uint256));
        return (cvxAmount);
    }

    /**
     * @notice decodeFees() is a function that decodes the fees from a given payload.
     * @dev decodeFees() takes in a bytes memory _payload and returns a uint256 amount.
     * It uses the abi.decode() function to decode the payload.
     */
    function decodeFees(bytes memory _payload) internal pure returns (uint256) {
        (, , uint256 amount) = abi.decode(_payload, (bytes4, uint8, uint256));
        return amount;
    }

    /**
     * @notice decodeLock() is a function that decodes a payload and returns the sender address and amount.
     * @dev decodeLock() takes a bytes memory _payload as an argument and returns an address and uint256.
     * It uses the ABI library to decode the payload and returns the sender address and amount.*/
    function decodeLock(bytes memory _payload) internal pure returns (address, uint256) {
        (, , address sender, uint256 amount) = abi.decode(_payload, (bytes4, uint8, address, uint256));
        return (sender, amount);
    }
}
