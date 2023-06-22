// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { AuraMath } from "../../utils/AuraMath.sol";
import { IRewardStaking } from "../../interfaces/IRewardStaking.sol";
import { IRewardPool4626 } from "../../interfaces/IRewardPool4626.sol";
import { IAuraOFT } from "../interfaces/IAuraOFT.sol";

/**
 * @title   SidechainClaimZap
 * @author  AuraFinance
 * @notice  Claim zap to bundle various reward claims
 * @dev     Claims from all pools, Bridges/Locks to L1 if Wanted and compounds if needed.
 *
 */
contract SidechainClaimZap {
    using SafeERC20 for IERC20;
    using AuraMath for uint256;

    receive() external payable {}

    address public cvx;
    address public cvxCrv;
    address public compounder;
    address public owner;
    uint16 public canonicalChainID;

    /**
     * @dev Claim rewards amounts.
     * - depositCvxMaxAmount    The max amount of CVX to deposit if locking CVX on L1
     * - depositCvxCrvMaxAmount The max amount of CvxCrv to deposit if compounding
     * - bridgeCvxMaxAmount     The max amount of cvx to bridge to L1
     */
    struct ClaimRewardsAmounts {
        uint256 lockCvxMaxAmount;
        uint256 depositCvxCrvMaxAmount;
        uint256 bridgeCvxMaxAmount;
    }

    /**
     * @dev options.
     * - useAllWalletFunds       Flag: lock rewards and existing balance
     * - sendCvxToL1             Flag: Bridge CVX to L1
     * - lockCvxL1               Flag: Lock CVX on L1
     * - useCompounder           Flag: Deposit CvxCrv into L2 compounder
     * - refundEth               Flag: Send Eth Remainder Back to Sender
     * - overrideL1Receiver      Flag: Override receiving L1 Address
     * - l1Receiever             Flag: L1 Address to receive to
     * - zro                     Flag: Zro address passed by user
     * - adapterParams           Flag: adapter params passed by user
     */
    struct Options {
        bool useAllWalletFunds;
        bool sendCvxToL1;
        bool lockCvxL1;
        bool useCompounder;
        bool refundEth;
        bool overrideL1Receiver;
        address l1Receiever;
        address zro;
        bytes adapterParams;
    }

    function initialize(
        address _owner,
        address _cvx,
        address _cvxCrv,
        address _compounder
    ) external {
        require(cvx == address(0), "already initialized");
        owner = _owner;
        cvx = _cvx;
        cvxCrv = _cvxCrv;
        compounder = _compounder;
        canonicalChainID = IAuraOFT(_cvx).canonicalChainId();
    }

    /**
     * @notice Returns meta data of contract
     */
    function getName() external pure returns (string memory) {
        return "Sidechain ClaimZap V1.0";
    }

    /**
     * @notice Approve spending of:
     *          cvxCrv  -> Compounder
     */
    function setApprovals() external {
        require(msg.sender == owner, "!auth");
        _approveToken(cvxCrv, compounder);
    }

    /**
     * @notice Allows a spender to spend a token
     * @param _token     Token that will be spend
     * @param _spender   Address that will be spending
     */
    function _approveToken(address _token, address _spender) internal {
        IERC20(_token).safeApprove(address(_spender), 0);
        IERC20(_token).safeApprove(address(_spender), type(uint256).max);
    }

    /**
     * @notice Claim all the rewards
     * @param rewardContracts        Array of addresses for LP token rewards
     * @param extraRewardContracts   Array of addresses for extra rewards
     * @param tokenRewardContracts   Array of addresses for token rewards e.g vlCvxExtraRewardDistribution
     * @param tokenRewardTokens      Array of token reward addresses to use with tokenRewardContracts
     * @param amounts                Claim rewards amounts.
     * @param options                Claim options
     */
    function claimRewards(
        address zroPaymentAddress,
        address[] calldata rewardContracts,
        address[] calldata extraRewardContracts,
        address[] calldata tokenRewardContracts,
        address[] calldata tokenRewardTokens,
        ClaimRewardsAmounts calldata amounts,
        Options calldata options
    ) external payable {
        require(tokenRewardContracts.length == tokenRewardTokens.length, "!parity");

        //Read balances prior to reward claims only if required
        uint256 cvxBalance;
        uint256 cvxCrvBalance;
        if (!options.useAllWalletFunds && _callOptions(options)) {
            cvxBalance = IERC20(cvx).balanceOf(msg.sender);
            cvxCrvBalance = IERC20(cvxCrv).balanceOf(msg.sender);
        }

        //claim from main curve LP pools
        for (uint256 i = 0; i < rewardContracts.length; i++) {
            IRewardStaking(rewardContracts[i]).getReward(msg.sender, true);
        }
        //claim from extra rewards
        for (uint256 i = 0; i < extraRewardContracts.length; i++) {
            IRewardStaking(extraRewardContracts[i]).getReward(msg.sender);
        }
        //claim from multi reward token contract
        for (uint256 i = 0; i < tokenRewardContracts.length; i++) {
            IRewardStaking(tokenRewardContracts[i]).getReward(msg.sender, tokenRewardTokens[i]);
        }

        // deposit/lock/stake
        if (_callOptions(options)) {
            _handleRewards(cvxBalance, cvxCrvBalance, zroPaymentAddress, amounts, options);
        }

        if (options.refundEth) {
            (bool sent, ) = payable(msg.sender).call{ value: address(this).balance }("");
            require(sent, "!refund");
        }
    }

    /**
     * @notice returns a bool if handling of rewards should occur
     * @param options                Claim options
     */
    function _callOptions(Options calldata options) internal pure returns (bool) {
        return (options.lockCvxL1 || options.sendCvxToL1 || options.useCompounder);
    }

    /**
     * @notice  Bridge Rewards to L1 or Lock cvxCrv into compounders
     * @param removeCvxBalance       cvxBalance to ignore and not redeposit (starting Cvx balance)
     * @param removeCvxCrvBalance    cvxCrvBalance to ignore and not redeposit (starting CvxCrv balance)
     * @param amounts                Claim rewards amoutns.
     * @param options                see claimRewards
     */
    // prettier-ignore
    function _handleRewards( // solhint-disable-line 
        uint256 removeCvxBalance,   
        uint256 removeCvxCrvBalance,       
        address zroPaymentAddress,
        ClaimRewardsAmounts calldata amounts, 
        Options calldata options
    ) internal {

        address _l1receiver = options.overrideL1Receiver ? options.l1Receiever : msg.sender;

        //Either lock cvx
        if(options.lockCvxL1){
            (uint256 cvxBalance, bool continued) = _checkBalanceAndPullToken(
                cvx,
                removeCvxBalance, 
                amounts.lockCvxMaxAmount
            );
            if (continued) IAuraOFT(cvx).lock{value: msg.value}(_l1receiver, cvxBalance, zroPaymentAddress);
        }
        //or bridge it back to l1
        else if (options.sendCvxToL1) {
            (uint256 cvxBalance, bool continued) = _checkBalanceAndPullToken(
                cvx,
                removeCvxBalance, 
                amounts.bridgeCvxMaxAmount
            );

            if (continued) IAuraOFT(cvx).sendFrom{value: msg.value}(
                address(this), 
                canonicalChainID, 
                abi.encodePacked(_l1receiver), 
                cvxBalance,
                payable(msg.sender), 
                options.zro, 
                options.adapterParams
            );
        }

        //deposit to l2 compounder
        if(options.useCompounder) {
            (uint256 cvxCrvBalance, bool continued) = _checkBalanceAndPullToken(
                cvxCrv,
                removeCvxCrvBalance, 
                amounts.depositCvxCrvMaxAmount
            );
            if (continued) IRewardPool4626(compounder).deposit(cvxCrvBalance, msg.sender);
        }
        
    }

    /**
     * @notice  Calculates the amount of a token to pull in, if this is above 0 then pulls token
     * @param _token                 the token to evaluate and pull
     * @param _removeAmount          quantity of token to ignore and not redeposit (ie starting balance)
     * @param _maxAmount             the maximum amount of a token
     */
    // prettier-ignore
    function _checkBalanceAndPullToken(
        address _token,
        uint256 _removeAmount,
        uint256 _maxAmount
    ) internal returns (uint256 _balance, bool continued) {
        _balance = IERC20(_token).balanceOf(msg.sender).sub(_removeAmount);
        _balance = AuraMath.min(_balance, _maxAmount);
        if (_balance > 0) {
            IERC20(_token).safeTransferFrom(msg.sender, address(this), _balance);
            continued = true;
        }
    }
}
