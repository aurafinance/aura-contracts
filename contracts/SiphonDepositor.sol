pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
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
    function totalSupply() external view returns (uint256);
    function INIT_MINT_AMOUNT() external view returns (uint256);
    function minterMinted() external view returns (uint256);
    function reductionPerCliff() external view returns (uint256);
    function totalCliffs() external view returns (uint256);
    function EMISSIONS_MAX_SUPPLY() external view returns (uint256);
}

contract SiphonDepositor {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for ICvx;

    IERC20 public immutable lpToken;
    IERC20 public immutable crv;
    IBooster public immutable booster;
    ICvx public immutable cvx;
    IERC20 public immutable rCvx;
    IAuraLocker public immutable auraLocker;
    uint256 public immutable pid;
    uint256 public immutable penaltyBp;

    constructor(
        IERC20 _lpToken,
        IERC20 _crv,
        IBooster _booster,
        ICvx _cvx,
        IERC20 _rCvx,
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
     */
    function siphon() external {
        uint256 bal = crv.balanceOf(address(this));
        crv.transfer(address(booster), bal);
        booster.earmarkRewards(pid);
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
     */
    function getAmountOut(uint256 _amount) public view returns (uint256) {
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
     * @dev Convert rAURA for AURA at the pro rata rate
     */
    function convert(uint256 _amount, bool _lock) external {
        uint256 amountOut = getAmountOut(_amount);

        if (_lock) {
            cvx.safeApprove(address(auraLocker), 0);
            cvx.safeApprove(address(auraLocker), amountOut);
            auraLocker.lock(msg.sender, amountOut);
        } else {
            // If there is an address for auraLocker, and not locking, apply a penalty
            uint256 penalty = amountOut * penaltyBp / 1000;
            uint256 amountWithPenalty = amountOut - penalty;
            rCvx.transferFrom(msg.sender, address(this), _amount);
            cvx.transfer(msg.sender, amountWithPenalty);
        }
    }
}
