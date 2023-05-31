// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @title IAuraOFT
 * @author  AuraFinance
 */
interface IAuraOFT {
    function lock(uint256 _cvxAmount, address receiver) external payable;

    function sendFrom(
        address _from,
        uint16 _dstChainId,
        bytes memory _toAddress,
        uint256 _amount,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes memory _adapterParams
    ) external payable;

    function canonicalChainId() external view returns (uint16);
}
