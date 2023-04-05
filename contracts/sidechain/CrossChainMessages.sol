// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @title Cross Chain Messages
 * @dev Share types for cross chain messages
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

    function encodeLock(address sender, uint256 amount) internal pure returns (bytes memory) {
        return abi.encode(MAGIC_BYTES, MessageType.LOCK, sender, amount);
    }

    function encodeFees(uint256 amount) internal pure returns (bytes memory) {
        return abi.encode(MAGIC_BYTES, MessageType.FEES, amount);
    }

    /* -------------------------------------------------------------------
       Decode 
    ------------------------------------------------------------------- */

    function decodeFeesCallback(bytes memory _payload)
        internal
        pure
        returns (
            address,
            uint256,
            uint256
        )
    {
        // TODO:
    }

    function decodeFees(bytes memory _payload) internal pure returns (uint256) {
        (, , uint256 amount) = abi.decode(_payload, (bytes4, uint8, uint256));
        return amount;
    }

    function decodeLock(bytes memory _payload) internal pure returns (address, uint256) {
        (, , address sender, uint256 amount) = abi.decode(_payload, (bytes4, uint8, address, uint256));
        return (sender, amount);
    }
}
