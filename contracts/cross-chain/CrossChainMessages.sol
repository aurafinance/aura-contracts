// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @title Cross Chain Messages
 * @dev Share types for cross chain messages
 */
contract CrossChainMessages {
    /// @dev Magic Bytes to pad the custom message with
    /// bytes4(keccak256("_isCustomMessage(bytes)"))
    bytes4 public constant MAGIC_BYTES = 0x7a7f9946;

    enum MessageType {
        LOCK,
        SIPHON
    }

    function _isCustomMessage(bytes memory _payload) internal pure returns (bool) {
        // Custom message payloads have the shape abi.encode(bytes32, bytes32, bytes32, MessageType, bytes4);
        // The length of this is 160. The OFT messages all have a length of 128 so we can assume that if the
        // length is 160 it is a custom message
        return _payload.length == 160;
    }

    function _encode(
        address x,
        uint256 y,
        uint256 c,
        MessageType messageType
    ) internal pure returns (bytes memory) {
        return abi.encode(x, y, c, messageType, MAGIC_BYTES);
    }

    function _encode(
        address x,
        address y,
        uint256 c,
        MessageType messageType
    ) internal pure returns (bytes memory) {
        return abi.encode(x, y, c, messageType, MAGIC_BYTES);
    }

    function _decodeSiphon(bytes memory payload)
        internal
        pure
        returns (
            address toAddress,
            uint256 cvxAmount,
            uint256 crvAmount,
            MessageType messageType
        )
    {
        (toAddress, cvxAmount, crvAmount, messageType, ) = abi.decode(
            payload,
            (address, uint256, uint256, MessageType, bytes4)
        );
    }

    function _decodeLock(bytes memory payload)
        internal
        pure
        returns (
            address fromAddress,
            address toAddress,
            uint256 amount,
            MessageType messageType
        )
    {
        (fromAddress, toAddress, amount, messageType, ) = abi.decode(
            payload,
            (address, address, uint256, MessageType, bytes4)
        );
    }

    function _getMessageType(bytes memory payload) internal pure returns (MessageType) {
        (, , , MessageType messageType, ) = abi.decode(payload, (bytes32, bytes32, bytes32, MessageType, bytes4));
        return messageType;
    }
}
