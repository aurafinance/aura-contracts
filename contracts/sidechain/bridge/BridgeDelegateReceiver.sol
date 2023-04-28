// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IL1Coordinator } from "../interfaces/IL1Coordinator.sol";

/**
 * @title   BridgeDelegateReceiver
 * @author  AuraFinance
 * @dev     Receive bridged tokens from the L2 on L1
 */
contract BridgeDelegateReceiver is Ownable {
    using SafeERC20 for IERC20;

    address public immutable l1Coordinator;

    uint16 public immutable srcChainId;

    /**
     * @dev Emitted when tokens are sent to a recipient.
     * @param amount The amount of fee debt settled.
     */
    event SettleFeeDebt(uint256 amount);

    /**
     * @dev Constructs the BridgeDelegateReceiver contract.
     * @param _l1Coordinator The address of the L1 Coordinator.
     * @param _srcChainId The source chain id.
     */
    constructor(address _l1Coordinator, uint16 _srcChainId) {
        l1Coordinator = _l1Coordinator;
        srcChainId = _srcChainId;

        address debtToken = IL1Coordinator(_l1Coordinator).balToken();
        IERC20(debtToken).safeApprove(_l1Coordinator, type(uint256).max);
    }

    /**
     * @dev Settle fee debt on the L1 Coordinator.
     * @param _amount The amount debt to settle
     * Requirements:
     * - The caller must be the owner of the contract.
     */
    function settleFeeDebt(uint256 _amount) external onlyOwner {
        IL1Coordinator(l1Coordinator).settleFeeDebt(srcChainId, _amount);

        emit SettleFeeDebt(_amount);
    }
}
