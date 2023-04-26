// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @title IGnosisBridge
 */
interface IGnosisBridge {
    function transferAndCall(
        address _to,
        uint256 _value,
        bytes memory _data
    ) external;

    event UserRequestForSignature(bytes32 indexed messageId, bytes encodedData);
}
