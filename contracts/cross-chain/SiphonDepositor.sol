pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

import { AuraMath } from "../utils/AuraMath.sol";
import { ICvx } from "../interfaces/ICvx.sol";
import { IAuraLocker } from "../interfaces/IAuraLocker.sol";
import { IrCvx } from "../interfaces/IrCvx.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { IBaseRewardPool } from "../interfaces/IBaseRewardPool.sol";
import { ILayerZeroEndpoint } from "./layer-zero/interfaces/ILayerZeroEndpoint.sol";

contract SiphonDepositor is Ownable {
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

    /// @dev rCVX token contract
    IrCvx public immutable rCvx;

    /// @dev Layer Zero endpoint contract
    ILayerZeroEndpoint public lzEndpoint;

    /// @dev Destination chain ID
    uint16 public immutable dstChainId;

    /// @dev Siphon Reciever on L2
    address public l2SiphonReceiver;

    /// @dev Penalty basis points 2500 == 25%
    uint256 public immutable penaltyBp;

    /* -------------------------------------------------------------------
      Events 
    ------------------------------------------------------------------- */

    event SetSiphonReceiver(address sender, address siphonReciever);

    event Deposit(address sender, uint256 amount);

    event Siphon(address sender, uint256 amount);

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
        IrCvx _rCvx,
        ILayerZeroEndpoint _lzEndpoint,
        uint16 _dstChainId,
        uint256 _penaltyBp
    ) {
        lpToken = _lpToken;
        crv = _crv;
        booster = _booster;
        cvx = _cvx;
        rCvx = _rCvx;
        auraLocker = _auraLocker;
        lzEndpoint = _lzEndpoint;
        pid = _pid;
        penaltyBp = _penaltyBp;
        dstChainId = _dstChainId;
    }

    /* -------------------------------------------------------------------
      Setter functions 
    ------------------------------------------------------------------- */

    /**
     * @dev Set the L2 siphonReciever contract address
     * @param _l2SiphonReceiver The address of the siphonReciever on L2
     */
    function setL2SiphonReceiver(address _l2SiphonReceiver) external onlyOwner {
        l2SiphonReceiver = _l2SiphonReceiver;
        emit SetSiphonReceiver(msg.sender, _l2SiphonReceiver);
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
    function siphon(uint256 _amount) external payable onlyOwner {
        _siphon(_amount);
        emit Siphon(msg.sender, _amount);
    }

    /**
     * @dev See SiphonDepositor.siphon
     */
    function _siphon(uint256 _amount) internal {
        uint256 amount = _getRewardsBasedOnIncentives(_amount);
        uint256 bal = crv.balanceOf(address(this));
        require(bal >= amount, "!balance");

        // Transfer CRV to the booster and earmarkRewards
        crv.transfer(address(booster), amount);
        booster.earmarkRewards(pid);

        // TODO: send rCVX to the lzEndpoint (L2)
        // TODO: do we actually need a token on L1?
        rCvx.mint(address(this), amount);

        lzEndpoint.send{ value: msg.value }(
            // destination chain
            dstChainId,
            // remote address packed with local address
            abi.encodePacked(l2SiphonReceiver, address(this)),
            // payload
            bytes(abi.encode(amount)),
            // refund address
            payable(msg.sender),
            // ZRO payment address,
            address(0),
            // adapter params
            bytes("")
        );
    }

    /**
     * @dev Call getReward on the BaseRewardPool which will return the
     *      BAL we previously depoisted minus the incentives that were paid
     *      Along with a pro rata amount of AURA tokens
     */
    function getReward() external onlyOwner {
        IBooster.PoolInfo memory info = booster.poolInfo(pid);
        IBaseRewardPool(info.crvRewards).getReward(address(this), false);
    }

    /* -------------------------------------------------------------------
      View functions 
    ------------------------------------------------------------------- */

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
     * @dev How much CVX you will get for rCVX
     *      rCVX can be redeemed at a rate determined by the totalSupply
     *      of rCVX and totalAmount of CVX the depositor has farmed.
     */
    function getAmountOut(uint256 _amount) public view returns (uint256) {
        // TODO: add a limit to the max rate
        uint256 totalSupply = rCvx.totalSupply();
        uint256 farmedTotal = cvx.balanceOf(address(this));
        return (_amount * farmedTotal) / totalSupply;
    }

    /* -------------------------------------------------------------------
      Layer Zero functions L1 -> L2 
    ------------------------------------------------------------------- */

    /**
     * @dev Convert rCVX for CVX at the pro rata rate
     * @param _to     Address that is converting rCVX to CVX
     * @param _amount Amount of rCVX to convert to CVX
     * @param _lock   If the CVX should be locked
     */
    function _convert(
        address _to,
        uint256 _amount,
        bool _lock
    ) internal {
        uint256 amountOut = getAmountOut(_amount);

        if (_lock || address(auraLocker) == address(0)) {
            cvx.safeApprove(address(auraLocker), 0);
            cvx.safeApprove(address(auraLocker), amountOut);
            auraLocker.lock(_to, amountOut);
        } else {
            // If there is an address for auraLocker, and not locking, apply a penalty
            uint256 penalty = (amountOut * penaltyBp) / 10000;
            uint256 amountWithPenalty = amountOut - penalty;
            cvx.transfer(_to, amountWithPenalty);
        }

        rCvx.burn(address(this), _amount);
    }

    /**
     * @dev LZ Receive function
     *      L2 calls this contract with an amount of rCVX tokens to convert
     *      to CVX
     * @param _srcChainId The source chain ID this transaction came from
     * @param _srcAddress The source address that sent this transaction
     * @param _nonce      Number used once
     * @param _payload    The transaction payload
     */
    function lzReceive(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        uint64 _nonce,
        bytes calldata _payload
    ) external {
        require(msg.sender == address(lzEndpoint), "!lzEndpoint");
        require(keccak256(_srcAddress) == keccak256(abi.encodePacked(l2SiphonReceiver)), "!srcAddress");

        (address to, uint256 amount, bool lock) = abi.decode(_payload, (address, uint256, bool));
        _convert(to, amount, lock);
    }
}
