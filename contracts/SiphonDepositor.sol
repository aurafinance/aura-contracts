pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { AuraMath } from "./AuraMath.sol";
import { IAuraLocker } from "./Interfaces.sol";

// prettier-ignore
interface IDeposit{
    function isShutdown() external view returns(bool);
    function balanceOf(address _account) external view returns(uint256);
    function totalSupply() external view returns(uint256);
    function rewardClaimed(uint256,address,uint256) external;
    function withdrawTo(uint256,uint256,address) external;
    function claimRewards(uint256,address) external returns(bool);
    function rewardArbitrator() external returns(address);
    function setGaugeRedirect(uint256 _pid) external returns(bool);
    function owner() external returns(address);
    function deposit(uint256 _pid, uint256 _amount, bool _stake) external returns(bool);
}

// prettier-ignore
interface IBooster {
    function earmarkRewards(uint256 _pid) external returns (bool);
    function deposit(uint256 _pid, uint256 _amount, bool _stake) external returns(bool);
    function withdraw(uint256 _pid, uint256 _amount) external returns(bool);
    function poolInfo(uint256) external view returns(address,address,address,address,address, bool);
}

// prettier-ignore
interface IBaseRewardPool {
    function getReward(address _account, bool _claimExtras) external returns(bool);
}

// prettier-ignore
interface ICvx is IERC20 {
    function INIT_MINT_AMOUNT() external view returns (uint256);
    function minterMinted() external view returns (uint256);
    function reductionPerCliff() external view returns (uint256);
    function totalCliffs() external view returns (uint256);
    function EMISSIONS_MAX_SUPPLY() external view returns (uint256);
}

// prettier-ignore
interface IrCvx is IERC20 {
    function mint(address,uint256) external; 
    function burn(address,uint256) external; 
}

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
    uint256 public immutable pid;

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
        uint256 _pid,
        uint256 _penaltyBp
    ) {
        lpToken = _lpToken;
        crv = _crv;
        booster = _booster;
        cvx = _cvx;
        rCvx = _rCvx;
        auraLocker = _auraLocker;
        pid = _pid;
        penaltyBp = _penaltyBp;
    }

    /**
     * @dev deposit "lpTokens" into the booster
     */
    function deposit() external {
        lpToken.approve(address(booster), type(uint256).max);
        uint256 bal = lpToken.balanceOf(address(this));
        booster.deposit(pid, bal, true);
    }

    /**
     * @dev withdraw "lpTokens" from the booster
     */
    function withdraw(uint256 _amount) external {
        booster.withdraw(pid, _amount);
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
    function siphon(uint256 _amount) external {
        // TODO: only callable by admin or lzEndpoint

        uint256 amount = (_amount * 10000) / 2500;
        uint256 bal = crv.balanceOf(address(this));
        require(bal >= amount, "!balance");

        // Transfer CRV to the booster and earmarkRewards
        crv.transfer(address(booster), amount);
        booster.earmarkRewards(pid);

        // Mint rCvx at a rate of 1:1 rAURA:BALRewards
        // TODO: send rAURA to the lzEndpoint (L2)
        rCvx.mint(address(this), amount);
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
     * @dev Transfer ERC20 tokens to recipient
     */
    function transferTokens(
        address token,
        address recipient,
        uint256 amount
    ) external onlyOwner {
        // TODO: remove this function
        IERC20(token).transfer(recipient, amount);
    }

    /**
     * @dev Convert rAURA for AURA at the pro rata rate
     */
    function convert(uint256 _amount, bool _lock) external {
        // TODO: only callable by the lzEndpoint
        // called from the L2 via lzEndpoint

        uint256 amountOut = getAmountOut(_amount);

        if (_lock) {
            cvx.safeApprove(address(auraLocker), 0);
            cvx.safeApprove(address(auraLocker), amountOut);
            auraLocker.lock(msg.sender, amountOut);
        } else {
            // If there is an address for auraLocker, and not locking, apply a penalty
            uint256 penalty = (amountOut * penaltyBp) / 10000;
            uint256 amountWithPenalty = amountOut - penalty;
            cvx.transfer(msg.sender, amountWithPenalty);
        }

        rCvx.burn(msg.sender, _amount);
    }
}
