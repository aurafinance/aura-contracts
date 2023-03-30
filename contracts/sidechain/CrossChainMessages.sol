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
        LOCK
    }

    function isCustomMessage(bytes memory _payload) internal pure returns (bool) {
        // TODO:
    }
}
