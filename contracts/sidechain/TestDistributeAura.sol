// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { AuraMath } from "../utils/AuraMath.sol";
import { IBooster } from "../interfaces/IBooster.sol";

interface IAuraMining {
    function convertCrvToCvx(uint256) external returns (uint256);
}

/**
 * @title   TestDistributeAura
 * @author  AuraFinance
 * @dev Dummy booster.distributeAura
 */
contract TestDistributeAura {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    uint256 public constant FEE_DENOMINATOR = 10000;

    address public immutable owner;
    IBooster public immutable booster;
    IERC20 public immutable aura;
    IAuraMining public immutable auraMining;

    address public bridgeDelegate;

    constructor(
        IBooster _booster,
        IERC20 _aura,
        IAuraMining _auraMining
    ) {
        owner = msg.sender;
        booster = _booster;
        aura = _aura;
        auraMining = _auraMining;
    }

    function setBridgeDelegate(address _bridgeDelegate) external {
        require(msg.sender == owner, "!auth");
        bridgeDelegate = _bridgeDelegate;
    }

    function distributeL2Fees(uint256 _amount) external {
        require(msg.sender == bridgeDelegate, "!auth");

        uint256 lockIncentive = booster.lockIncentive();
        uint256 stakerIncentive = booster.stakerIncentive();

        // calculate the rewards that were paid based on the incentives that
        // are being distributed
        uint256 totalIncentives = lockIncentive.add(stakerIncentive);
        uint256 totalFarmed = _amount.mul(FEE_DENOMINATOR).div(totalIncentives);
        uint256 eligibleForMint = totalFarmed.sub(_amount);

        aura.safeTransfer(bridgeDelegate, auraMining.convertCrvToCvx(eligibleForMint));
    }

    function withdrawERC20(
        address _token,
        address _to,
        uint256 _amount
    ) external {
        require(msg.sender == owner, "!auth");
        IERC20(_token).safeTransfer(_to, _amount);
    }
}
