// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { AuraMath } from "../utils/AuraMath.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IL1Coordinator } from "../sidechain/interfaces/IL1Coordinator.sol";

/**
 * @author Aura Finance
 * @title AuraDistributor
 * @dev Distribute AURA to the L2s wrapped in a L1Coordinator BAL balance check
 */
contract AuraDistributor is Ownable {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev The treasury address
    address public immutable treasury;

    /// @dev The token to send to the address
    address public immutable balToken;

    /// @dev The address to send the tokens to
    address public immutable l1Coordinator;

    /// @dev The distributor address
    address public distributor;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    event Distribute(uint256 balBalanceBefore, uint256 totalFeeDebt, uint256 balShortfall);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @param _treasury         The treasury address
     * @param _balToken         The BAL token address
     * @param _l1Coordinator    The L1Coordinator address
     * @param _distributor      The distributor address
     */
    constructor(
        address _treasury,
        address _balToken,
        address _l1Coordinator,
        address _distributor
    ) {
        treasury = _treasury;
        balToken = _balToken;
        l1Coordinator = _l1Coordinator;
        distributor = _distributor;
    }

    /* -------------------------------------------------------------------
       Setters 
    ------------------------------------------------------------------- */

    function setDistributor(address _distributor) external onlyOwner {
        distributor = _distributor;
    }

    /* -------------------------------------------------------------------
       Core 
    ------------------------------------------------------------------- */

    /**
     * @dev Distribute AURA tokens to the L1's
     */
    function distributedAura(
        uint16[] memory _srcChainId,
        address[] memory _zroPaymentAddress,
        address[] memory _sendFromZroPaymentAddress,
        bytes[] memory _sendFromAdapterParams,
        uint256[] memory _values
    ) external payable {
        require(msg.sender == distributor, "!distributor");

        uint256 srcChainIdLen = _srcChainId.length;
        require(
            srcChainIdLen == _zroPaymentAddress.length &&
                _zroPaymentAddress.length == _sendFromAdapterParams.length &&
                _sendFromAdapterParams.length == _sendFromZroPaymentAddress.length &&
                _sendFromZroPaymentAddress.length == _values.length,
            "!length"
        );

        uint256 balBalance = IERC20(balToken).balanceOf(l1Coordinator);
        uint256 totalFeeDebt = 0;

        for (uint256 i = 0; i < srcChainIdLen; i++) {
            uint16 srcChainId = _srcChainId[i];
            uint256 feeDebt = IL1Coordinator(l1Coordinator).feeDebtOf(srcChainId);
            uint256 distributedFeeDebt = IL1Coordinator(l1Coordinator).distributedFeeDebtOf(srcChainId);
            totalFeeDebt = totalFeeDebt.add(feeDebt.sub(distributedFeeDebt));
        }

        // If there is more feeDebt to settle than their is BAL in the
        // L1Coordinator then we need to send oversome BAL to cover
        uint256 balShortfall = totalFeeDebt > balBalance ? totalFeeDebt.sub(balBalance) : 0;
        if (balShortfall > 0) {
            IERC20(balToken).safeTransfer(l1Coordinator, balShortfall);
        }

        for (uint256 i = 0; i < srcChainIdLen; i++) {
            IL1Coordinator(l1Coordinator).distributeAura{ value: _values[i] }(
                _srcChainId[i],
                _zroPaymentAddress[i],
                _sendFromZroPaymentAddress[i],
                _sendFromAdapterParams[i]
            );
        }

        emit Distribute(balBalance, totalFeeDebt, balShortfall);
    }

    /**
     * @dev Withdraw ERC20 tokens to treasury
     * @param _token    The token address to withdraw
     * @param _amount   The amount of tokens to send
     */
    function withdrawERC20(address _token, uint256 _amount) external onlyOwner {
        IERC20(_token).safeTransfer(treasury, _amount);
    }

    /**
     * @dev Withdraw ETH balance to treasury
     */
    function withdrawEthBalance() external onlyOwner {
        address addr = address(this);
        (bool sent, ) = payable(treasury).call{ value: addr.balance }("");
        require(sent, "!withdrawn");
    }

    receive() external payable {}
}
