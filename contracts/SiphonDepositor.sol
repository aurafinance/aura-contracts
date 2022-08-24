pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

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

contract SiphonDepositor {
    using SafeERC20 for IERC20;

    IERC20 public immutable lpToken;
    IERC20 public immutable crv;
    IBooster public immutable booster;
    uint256 public immutable pid;

    constructor(
        IERC20 _lpToken,
        IERC20 _crv,
        IBooster _booster,
        uint256 _pid
    ) {
        lpToken = _lpToken;
        crv = _crv;
        booster = _booster;
        pid = _pid;
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
}

