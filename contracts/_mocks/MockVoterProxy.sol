// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @title MockVoterProxy
 * @notice Minimal forwarder used only in unit tests for WindDownCoordinator.
 *         Accepts any caller for `execute`, making it easy to wire the
 *         coordinator's VoterProxy-execute path without running the full
 *         shutdown dance.
 */
contract MockVoterProxy {
    function execute(
        address _to,
        uint256 _value,
        bytes calldata _data
    ) external returns (bool, bytes memory) {
        (bool success, bytes memory result) = _to.call{ value: _value }(_data);
        require(success, "!success");
        return (success, result);
    }

    receive() external payable {}
}
