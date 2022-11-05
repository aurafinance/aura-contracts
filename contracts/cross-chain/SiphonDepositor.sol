// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import { AuraMath } from "../utils/AuraMath.sol";
import { ICvx } from "../interfaces/ICvx.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { IAuraLocker } from "../interfaces/IAuraLocker.sol";
import { IBaseRewardPool } from "../interfaces/IBaseRewardPool.sol";
import { OFTCore } from "./layer-zero/token/oft/OFTCore.sol";
import { CrossChainMessages } from "./CrossChainMessages.sol";

contract SiphonDepositor is OFTCore, CrossChainMessages {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for ICvx;

    /* -------------------------------------------------------------------
      Storage 
    ------------------------------------------------------------------- */

    /// @dev siphon LP token
    IERC20 public immutable lpToken;

    /// @dev Pool ID
    uint256 public immutable pid;

    /// @dev Booster contract
    IBooster public immutable booster;

    /// @dev Aura Locker contract
    IAuraLocker public immutable auraLocker;

    /// @dev CRV token contract
    IERC20 public immutable crv;

    /// @dev CVX token contract
    ICvx public immutable cvx;

    /// @dev chainID to l2Coordinator contracts
    mapping(uint16 => address) public l2Coordinators;

    /// @dev source chain id mapped to bridge delegate contracts
    mapping(uint16 => address) public bridgeDelegates;

    mapping(uint16 => uint256) public pendingRewards;

    /* -------------------------------------------------------------------
      Events 
    ------------------------------------------------------------------- */

    event Deposit(address sender, uint256 amount);

    event Siphon(address sender, uint256 dstChainId, address toAddress, uint256 amount);

    event Lock(address from, uint16 dstChainId, uint256 amount);

    event UpdateBridgeDelegate(uint16 srcChainId, address bridgeDelegate);

    event UpdateL2Coordinator(uint16 chainId, address l2Coordinator);

    /* -------------------------------------------------------------------
      Constructor 
    ------------------------------------------------------------------- */

    /**
     * @param _lpToken          Siphon LP token contract
     * @param _pid              The pool Id
     * @param _booster          Booster contract
     * @param _auraLocker       Aura locker contract
     * @param _crv              CRV token contract
     * @param _cvx              CRV token contract
     * @param _lzEndpoint       LayerZeroEndpoint contract
     */
    constructor(
        IERC20 _lpToken,
        uint256 _pid,
        IBooster _booster,
        IAuraLocker _auraLocker,
        IERC20 _crv,
        ICvx _cvx,
        address _lzEndpoint
    ) OFTCore(_lzEndpoint) {
        lpToken = _lpToken;
        crv = _crv;
        booster = _booster;
        cvx = _cvx;
        auraLocker = _auraLocker;
        pid = _pid;
    }

    /* -------------------------------------------------------------------
      Owner functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Approve booster to spend LP token
     */
    function setApprovals() external {
        lpToken.safeApprove(address(booster), type(uint256).max);
    }

    /**
     * @dev Deposit siphon lpTokens into the booster
     *      Only callable by the owner
     */
    function deposit() external onlyOwner {
        uint256 bal = lpToken.balanceOf(address(this));
        booster.deposit(pid, bal, true);
        emit Deposit(msg.sender, bal);
    }

    /**
     * @dev Pre farm CVX tokens from the booster so that when the first siphon
     *      Is called there are already CVX tokens in this contract ready to be claimed
     * @param _amount Amount of CRV to send to Booster before calling earmarkRewards
     */
    function farm(uint256 _amount) external onlyOwner {
        _earmarkRewards(_amount);
    }

    /**
     * @dev Call getReward on the BaseRewardPool which will return the
     *      CRV we previously deposited minus the incentives that were paid
     *      Along with a pro rata amount of CVX tokens
     */
    function getReward() external onlyOwner {
        IBooster.PoolInfo memory info = booster.poolInfo(pid);
        IBaseRewardPool(info.crvRewards).getReward(address(this), false);
    }

    /**
     * @dev Earmark rewards and siphon reward tokens
     * @param _amount Amount of CRV to send to booster to siphon CVX
     */
    function _earmarkRewards(uint256 _amount) internal {
        uint256 bal = crv.balanceOf(address(this));
        require(bal >= _amount, "!balance");
        // Transfer CRV to the booster and earmarkRewards
        crv.safeTransfer(address(booster), _amount);
        booster.earmarkRewards(pid);
    }

    /* -------------------------------------------------------------------
      Setter Functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Set bridge delegate for a source chain ID
     * @param _srcChainId     Source chain ID
     * @param _bridgeDelegate The bridgeDelegate address
     */
    function setBridgeDelegate(uint16 _srcChainId, address _bridgeDelegate) external onlyOwner {
        require(_bridgeDelegate != address(0), "bridgeDelegate invalid");
        bridgeDelegates[_srcChainId] = _bridgeDelegate;
        emit UpdateBridgeDelegate(_srcChainId, _bridgeDelegate);
    }

    /**
     * @dev Set l2 coordinator
     * @param _chainId        The chain ID
     * @param _l2Coordinator  The L2 coordinator address
     */
    function setL2Coordinator(uint16 _chainId, address _l2Coordinator) external onlyOwner {
        l2Coordinators[_chainId] = _l2Coordinator;
        emit UpdateL2Coordinator(_chainId, _l2Coordinator);
    }

    /* -------------------------------------------------------------------
      View functions 
    ------------------------------------------------------------------- */

    function circulatingSupply() external view override returns (uint256) {
        return cvx.totalSupply() - cvx.balanceOf(address(this));
    }

    /**
     * @dev Get amount of CRV that was claimed based on the incentives
     *      That were paid out
     * @param _amount The amount of incentives paid
     * @return The total rewards paid out
     */
    function _getRewardsBasedOnIncentives(uint256 _amount) internal view returns (uint256) {
        uint256 totalIncentives = booster.lockIncentive() +
            booster.stakerIncentive() +
            booster.earmarkIncentive() +
            booster.platformFee();
        return ((_amount * booster.FEE_DENOMINATOR()) / totalIncentives);
    }

    /**
     * @dev Public view function of _getRewardsBasedOnIncentives
     */
    function getRewardsBasedOnIncentives(uint256 _amount) external view returns (uint256) {
        return _getRewardsBasedOnIncentives(_amount);
    }

    /**
     * @dev Get expected amount out of CVX tokens based on CRV input
     * @param _amount CRV amount in
     * @return The total amount of CVX out
     */
    function _getAmountOut(uint256 _amount) internal view returns (uint256) {
        uint256 totalSupply = cvx.totalSupply();
        uint256 INIT_MINT_AMOUNT = cvx.INIT_MINT_AMOUNT();
        // TODO: this is internal on the Aura token...
        uint256 minterMinted = 0;
        uint256 reductionPerCliff = cvx.reductionPerCliff();
        uint256 totalCliffs = cvx.totalCliffs();
        uint256 EMISSIONS_MAX_SUPPLY = cvx.EMISSIONS_MAX_SUPPLY();

        uint256 emissionsMinted = totalSupply - INIT_MINT_AMOUNT - minterMinted;
        uint256 cliff = emissionsMinted.div(reductionPerCliff);

        uint256 amount;
        if (cliff < totalCliffs) {
            uint256 reduction = totalCliffs.sub(cliff).mul(5).div(2).add(700);
            amount = _amount.mul(reduction).div(totalCliffs);
            uint256 amtTillMax = EMISSIONS_MAX_SUPPLY.sub(emissionsMinted);
            if (amount > amtTillMax) {
                amount = amtTillMax;
            }
        }
        return amount;
    }

    /**
     * @dev Public view function of _getAmountOut
     */
    function getAmountOut(uint256 _amount) external view returns (uint256) {
        return _getAmountOut(_amount);
    }

    /* -------------------------------------------------------------------
      OFT functions
    ------------------------------------------------------------------- */

    /**
     * @dev Handle tokens being sent from `_from`. Called when _send is called
     * @param _from The address to whom you are receiving tokens from on the source chain
     * @param _amount The amounts of the tokens to transfer
     */
    function _debitFrom(
        address _from,
        uint16, // _dstChainId The L0 defined chain id the tokens were sent to
        bytes memory, // _toAddress The address to whom you are sending tokens to on the dstChain
        uint256 _amount
    ) internal virtual override {
        require(_from == _msgSender(), "ProxyOFT: owner is not send caller");
        cvx.safeTransferFrom(_from, address(this), _amount);
    }

    /**
     * @dev Handle tokens being recieved to `_toAddress` called by lzReceive
     * @param _toAddress The address to whom you are sending tokens to on the dstChain
     * @param _amount The amounts of the tokens to transfer
     */
    function _creditTo(
        uint16, // _srcChainId The L0 defined chain id the tokens were sent from
        address _toAddress,
        uint256 _amount
    ) internal virtual override {
        cvx.safeTransfer(_toAddress, _amount);
    }

    /* -------------------------------------------------------------------
      Layer Zero functions L2 -> L1 
    ------------------------------------------------------------------- */

    /**
     * @dev Siphon CVX tokens by depositing CRV into the Booster
     *      and then calling earmark rewards which will send the CRV
     *      to the siphon pools BaseRewardPool
     *      Only callable by the owner
     * @param _dstChainId   The destination chain ID (L2) that called this L1 function which calls
     *                      back to the L2 chain
     */
    function siphon(uint16 _dstChainId, bytes memory adapterParams) external payable onlyOwner {
        uint256 rewardsAmount = pendingRewards[_dstChainId];
        pendingRewards[_dstChainId] = 0;

        _earmarkRewards(rewardsAmount);

        address l2Coordinator = l2Coordinators[_dstChainId];

        uint256 cvxAmountOut = _getAmountOut(rewardsAmount);
        bytes memory _payload = _encode(l2Coordinator, cvxAmountOut, rewardsAmount, MessageType.SIPHON);

        _lzSend(
            // destination chain
            _dstChainId,
            // to address packed with rewardsAmount
            _payload,
            // refund address
            payable(msg.sender),
            // ZRO payment address
            address(0),
            // adapter params
            adapterParams,
            // navtive fee
            msg.value
        );

        emit Siphon(msg.sender, _dstChainId, l2Coordinator, rewardsAmount);
    }

    /**
     * @dev Lock tokens in the Locker contract
     * @param _fromAddress  Address that is locking
     * @param _cvxAmount    Amount to lock
     * @param _srcChainId   Source chain ID
     */
    function _lock(
        address _fromAddress,
        uint256 _cvxAmount,
        uint16 _srcChainId
    ) internal {
        cvx.safeIncreaseAllowance(address(auraLocker), _cvxAmount);
        auraLocker.lock(_fromAddress, _cvxAmount);

        emit Lock(_fromAddress, _srcChainId, _cvxAmount);
    }

    /**
     * @dev Overrite the default OFT lzReceive function logic to
     *      Support locking and siphoning
     */
    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes memory _payload
    ) internal virtual override {
        if (_isCustomMessage(_payload)) {
            MessageType messageType = _getMessageType(_payload);

            if (messageType == MessageType.LOCK) {
                // Approve the locker, decode the payload and lock
                (address fromAddress, , uint256 cvxAmount, ) = _decodeLock(_payload);
                _lock(fromAddress, cvxAmount, _srcChainId);
            } else if (messageType == MessageType.SIPHON) {
                // Called when Booster.earmarkRewards calls l2Coordinator.queueNewRewards
                (, , uint256 incentivesAmount, ) = _decodeSiphon(_payload);

                // Convert to pro rata rewards amount based on incentives paid
                uint256 rewardsAmount = _getRewardsBasedOnIncentives(incentivesAmount);
                pendingRewards[_srcChainId] += rewardsAmount;
            }
        } else {
            // Continue with the normal flow for an OFT transfer
            super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }
}
