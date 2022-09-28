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

/**
 * @title   SiphonDepositor
 * @author  Aura
 * @dev  TODO
 */
contract SiphonDepositor is OFTCore, CrossChainMessages {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for ICvx;

    /* -------------------------------------------------------------------
      Storage 
    ------------------------------------------------------------------- */

    /// @dev Siphon LP token
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

    /// @dev l2Coordinator contract
    address public immutable l2Coordinator;

    /// @dev source destinations mapped to CRV debt
    mapping(uint16 => uint256) public debts;

    /// @dev source chain id mapped to bridge delegate contracts
    mapping(uint16 => address) public bridgeDelegates;

    /* -------------------------------------------------------------------
      Events 
    ------------------------------------------------------------------- */

    event Deposit(address sender, uint256 amount);

    event Siphon(address sender, uint256 dstChainId, address toAddress, uint256 amount);

    event Lock(address from, uint16 dstChainId, uint256 amount);

    event UpdateBridgeDelegate(uint16 srcChainId, address bridgeDelegate);

    event RepayDebt(address sender, uint16 srcChainId, uint256 amount);

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
     * @param _l2Coordinator    l2Coordinator contract
     * @param _lzEndpoint       LayerZeroEndpoint contract
     */
    constructor(
        IERC20 _lpToken,
        uint256 _pid,
        IBooster _booster,
        IAuraLocker _auraLocker,
        IERC20 _crv,
        ICvx _cvx,
        address _l2Coordinator,
        address _lzEndpoint
    ) OFTCore(_lzEndpoint) {
        // TODO checks for zero address?
        lpToken = _lpToken;
        crv = _crv;
        booster = _booster;
        cvx = _cvx;
        auraLocker = _auraLocker;
        pid = _pid;
        l2Coordinator = _l2Coordinator;
    }

    function setApprovals() external {
        lpToken.safeApprove(address(booster), type(uint256).max);
    }

    /* -------------------------------------------------------------------
      Owner functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Deposit siphon lpTokens into the booster
     *      Only callable by the owner
     */
    function deposit() external onlyOwner {
        uint256 bal = lpToken.balanceOf(address(this));
        // is it expected to stake while depositing? `true` if yes, it should be metion on the docs of the function.
        booster.deposit(pid, bal, true);
        // booster returns a true if successfull , evalute it?
        // do we need to double check the deposit by checking the balance before and after  similar to convex-platform/contracts/contracts/BaseRewardPool4626.sol
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
     *      CRV we previously depoisted minus the incentives that were paid
     *      Along with a pro rata amount of CVX tokens
     */
    function getReward() external onlyOwner {
        IBooster.PoolInfo memory info = booster.poolInfo(pid);
        // Is it ok to do not get the extra rewards or shall this be an argument of this fn?
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
        require(booster.earmarkRewards(pid), "!earmark reward");
    }

    /* -------------------------------------------------------------------
      Repay Debt Functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Set bridge delegate for a source chain ID
     * @param _srcChainId     Source chain ID
     * @param _bridgeDelegate The bridgeDelegate address
     */
    function setBridgeDelegate(uint16 _srcChainId, address _bridgeDelegate) external onlyOwner {
        require(_bridgeDelegate != address(0), "Invalid address");
        bridgeDelegates[_srcChainId] = _bridgeDelegate;
        emit UpdateBridgeDelegate(_srcChainId, _bridgeDelegate);
    }

    /**
     * @dev Repay incentives debt that is owed from the L2
     * @param _srcChainId   The source chain ID
     * @param _amount       Amount to repay
     */
    function repayDebt(uint16 _srcChainId, uint256 _amount) external {
        // is it ok without modifier onlyOwner ?
        address bridgeDelegate = bridgeDelegates[_srcChainId];
        require(msg.sender == bridgeDelegate, "!bridgeDelegate");
        require(_amount <= debts[_srcChainId], "amount > debt");

        debts[_srcChainId] -= _amount;

        IERC20(crv).safeTransferFrom(bridgeDelegate, address(this), _amount);

        emit RepayDebt(msg.sender, _srcChainId, _amount);
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
     * @param _amount       Amount of CRV that is being bridged from the L2 to cover the
     *                      Incentive amount that was paid out.
     *                      We assume the total incentives that have been paid out are equal
     *                      to the MaxFees on the Booster which is 2500/10000 (25%)
     * @param _dstChainId   The destination chain ID (L2) that called this L1 function which calls
     *                      back to the L2 chain
     */
    function _siphon(uint256 _amount, uint16 _dstChainId) internal {
        // TODO: should this call getReward?
        uint256 crvAmount = _getRewardsBasedOnIncentives(_amount);
        _earmarkRewards(crvAmount);

        // Siphon is called by the L2 booster.earmarkRewards which calls l2Coordinator.queueNewRewards
        // We need to track the amount of CRV incentives that have been paid on the L1 to siphon the CVX
        // and make sure when the L2 finally bridges the CRV incentives back to the L1 that these debts
        // are repaid.
        //
        // NOTE: _dstChainId is actually _srcChainId because this function is called by the L2 calling
        // LzReceive and then this L1 calling back to the L2.
        debts[_dstChainId] += _amount;

        uint256 cvxAmountOut = _getAmountOut(crvAmount);
        bytes memory _payload = _encode(l2Coordinator, cvxAmountOut, crvAmount, MessageType.SIPHON);

        _lzSend(
            // destination chain
            _dstChainId,
            // to address packed with crvAmount
            _payload,
            // refund address
            payable(msg.sender),
            // ZRO payment address
            address(0),
            // adapter params
            bytes("")
        );

        emit Siphon(msg.sender, _dstChainId, l2Coordinator, _amount);
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
                (, , uint256 crvAmount, ) = _decodeSiphon(_payload);
                _siphon(crvAmount, _srcChainId);
            }
        } else {
            // Continue with the normal flow for an OFT transfer
            super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }
}
