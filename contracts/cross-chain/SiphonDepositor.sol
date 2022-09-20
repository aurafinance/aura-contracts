pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import { AuraMath } from "../utils/AuraMath.sol";
import { ICvx } from "../interfaces/ICvx.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { IAuraLocker } from "../interfaces/IAuraLocker.sol";
import { IBaseRewardPool } from "../interfaces/IBaseRewardPool.sol";
import { OFTCore } from "./layer-zero/token/oft/OFTCore.sol";

contract SiphonDepositor is OFTCore {
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

    /// @dev l2Coordinator contract
    address public immutable l2Coordinator;

    /* -------------------------------------------------------------------
      Events 
    ------------------------------------------------------------------- */

    event SetSiphonReceiver(address sender, address siphonReciever);

    event Deposit(address sender, uint256 amount);

    event Siphon(address sender, uint256 dstChainId, address toAddress, uint256 amount);

    /* -------------------------------------------------------------------
      Constructor 
    ------------------------------------------------------------------- */

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
        lpToken = _lpToken;
        crv = _crv;
        booster = _booster;
        cvx = _cvx;
        auraLocker = _auraLocker;
        pid = _pid;
        l2Coordinator = _l2Coordinator;
    }

    /* -------------------------------------------------------------------
      Owner functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Deposit siphon lpTokens into the booster
     *      Only callable by the owner
     */
    function deposit() external onlyOwner {
        lpToken.approve(address(booster), type(uint256).max);
        uint256 bal = lpToken.balanceOf(address(this));
        booster.deposit(pid, bal, true);
        emit Deposit(msg.sender, bal);
    }

    /**
     * @dev Siphon CVX tokens by depositing BAL into the Booster
     *      and then calling earmark rewards which will send the BAL
     *      to the siphon pools BaseRewardPool
     *      Only callable by the owner
     * @param _amount Amount of BAL that is being bridged from the L2 to cover the
     *                Incentive amount that was paid out.
     *                We assume the total incentives that have been paid out are equal
     *                to the MaxFees on the Booster which is 2500/10000 (25%)
     */
    function siphon(uint256 _amount, uint16 _dstChainId) external payable onlyOwner {
        uint256 amount = _getRewardsBasedOnIncentives(_amount);

        uint256 bal = crv.balanceOf(address(this));
        require(bal >= amount, "!balance");

        // Transfer CRV to the booster and earmarkRewards
        crv.transfer(address(booster), amount);
        booster.earmarkRewards(pid);

        uint256 cvxAmountOut = _getAmountOut(amount);
        bytes memory _payload = abi.encode(abi.encodePacked(l2Coordinator), cvxAmountOut, amount);
        // TODO: need to modify this to also send the AURA rate
        // so that the L2Coordinator has the most up to date rate
        // when L2Coordinator.mint() is called from the L2Booster
        _lzSend(
            // destination chain
            _dstChainId,
            // to address packed with amount
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
     * @dev Call getReward on the BaseRewardPool which will return the
     *      BAL we previously depoisted minus the incentives that were paid
     *      Along with a pro rata amount of CVX tokens
     */
    function getReward() external onlyOwner {
        IBooster.PoolInfo memory info = booster.poolInfo(pid);
        IBaseRewardPool(info.crvRewards).getReward(address(this), false);
    }

    /* -------------------------------------------------------------------
      View functions 
    ------------------------------------------------------------------- */

    function circulatingSupply() external view override returns (uint256) {
        return cvx.totalSupply() - cvx.balanceOf(address(this));
    }

    /**
     * @dev Get amount of BAL that was claimed based on the incentives
     *      That were paid out
     * @param _amount The amount of incentives paid
     * @return The total rewards paid out
     */
    function _getRewardsBasedOnIncentives(uint256 _amount) internal returns (uint256) {
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
      Layer Zero functions
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
        // TODO: if tokens are being sent to L1 AuraLocker contract then call lock on AuraLocker
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
}
