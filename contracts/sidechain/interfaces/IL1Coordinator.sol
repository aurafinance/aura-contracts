// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @title IL1Coordinator
 * @author  AuraFinance
 */
interface IL1Coordinator {
    function balToken() external view returns (address);

    function settleFeeDebt(uint16 srcChainId, uint256 amount) external;

    function feeDebtOf(uint16 srcChainId) external view returns (uint256);

    function distributedFeeDebtOf(uint16 srcChainId) external view returns (uint256);

    function distributeAura(
        uint16 _srcChainId,
        address _zroPaymentAddress,
        address _sendFromZroPaymentAddress,
        bytes memory _sendFromAdapterParams
    ) external payable;
}
