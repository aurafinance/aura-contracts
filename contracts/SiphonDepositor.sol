pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

import { AuraMath } from "./AuraMath.sol";
import { ICvx } from "./interfaces/ICvx.sol";
import { IAuraLocker } from "./Interfaces.sol";
import { IrCvx } from "./interfaces/IrCvx.sol";
import { IBooster } from "./interfaces/IBooster.sol";
import { IBaseRewardPool } from "./interfaces/IBaseRewardPool.sol";
import { ILayerZeroEndpoint } from "./interfaces/ILayerZeroEndpoint.sol";

contract SiphonDepositor is Ownable {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for ICvx;

    IERC20 public immutable lpToken;
    IERC20 public immutable crv;
    IBooster public immutable booster;
    ICvx public immutable cvx;
    IrCvx public immutable rCvx;
    IAuraLocker public immutable auraLocker;
    ILayerZeroEndpoint public lzEndpoint;
    address public l2SiphonReceiver;
    uint256 public immutable pid;
    uint16 public immutable dstChainId;

    /**
     * @dev Penalty basis points 2500 == 25%
     */
    uint256 public immutable penaltyBp;

    constructor(
        IERC20 _lpToken,
        IERC20 _crv,
        IBooster _booster,
        ICvx _cvx,
        IrCvx _rCvx,
        IAuraLocker _auraLocker,
        ILayerZeroEndpoint _lzEndpoint,
        uint256 _pid,
        uint256 _penaltyBp,
        uint16 _dstChainId
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

    function setL2SiphonReceiver(address _l2SiphonReceiver) external onlyOwner {
        l2SiphonReceiver = _l2SiphonReceiver;
    }

    /**
     * @dev deposit "lpTokens" into the booster
     */
    function deposit() external {
        lpToken.approve(address(booster), type(uint256).max);
        uint256 bal = lpToken.balanceOf(address(this));
        booster.deposit(pid, bal, true);
    }

    function siphon(uint256 _amount) external payable onlyOwner {
        _siphon(_amount);
    }

    /**
     * @dev Siphon AURA tokens by depositing BAL into the Booster
     *      and then calling earmark rewards which will send the BAL
     *      to the siphon pools BaseRewardPool
     * @param _amount Amount of BAL that is being bridged from the L2 to cover the
     *                Incentive amount that was paid out.
     *                We assume the total incentives that have been paid out are equal
     *                to the MaxFees on the Booster which is 2500/10000 (25%)
     */
    function _siphon(uint256 _amount) internal {
        uint256 amount = _getIncentives(_amount);
        uint256 bal = crv.balanceOf(address(this));
        require(bal >= amount, "!balance");

        // Transfer CRV to the booster and earmarkRewards
        crv.transfer(address(booster), amount);
        booster.earmarkRewards(pid);

        // Mint rCvx at a rate of 1:1 rAURA:BALRewards
        // TODO: send rAURA to the lzEndpoint (L2)
        // TODO: do we actually need a token on L1?
        rCvx.mint(address(this), amount);

        lzEndpoint.send{ value: msg.value }(
            dstChainId, // _dstChainId,
            abi.encodePacked(l2SiphonReceiver, address(this)), // _lzRemoteLookup[_dstChainId],
            bytes(abi.encode(amount)), // _payload,
            payable(msg.sender), // _refundAddress,
            address(0), // _zroPaymentAddress,
            bytes("") // _adapterParams
        );
    }

    function _getIncentives(uint256 _amount) internal returns (uint256) {
        uint256 totalIncentives = booster.lockIncentive() +
            booster.stakerIncentive() +
            booster.earmarkIncentive() +
            booster.platformFee();
        return (_amount * booster.FEE_DENOMINATOR()) / totalIncentives;
    }

    /**
     * @dev Call getReward on the BaseRewardPool which will return the
     *      BAL we previously depoisted minus the incentives that were paid
     *      Along with a pro rata amount of AURA tokens
     */
    function getReward() external {
        (, , , address crvRewards, , ) = booster.poolInfo(pid);
        IBaseRewardPool(crvRewards).getReward(address(this), false);
    }

    /**
     * @dev How much AURA you will get for rAURA
     *      rAURA can be redeemed at a rate determined by the totalSupply
     *      of rAURA and totalAmount of AURA the depositor has farmed.
     */
    function getAmountOut(uint256 _amount) public view returns (uint256) {
        uint256 totalSupply = rCvx.totalSupply();
        uint256 farmedTotal = cvx.balanceOf(address(this));
        return (_amount * farmedTotal) / totalSupply;
    }

    /**
     * @dev Convert rAURA for AURA at the pro rata rate
     */
    function _convert(
        address _to,
        uint256 _amount,
        bool _lock
    ) internal {
        uint256 amountOut = getAmountOut(_amount);

        if (_lock) {
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
