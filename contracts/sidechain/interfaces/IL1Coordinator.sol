// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @title IL1Coordinator
 * @author  AuraFinance
 */
interface IL1Coordinator {
    function balToken() external view returns (address);

    function settleFeeDebt(uint16 srcChainId, uint256 amount) external;
}
