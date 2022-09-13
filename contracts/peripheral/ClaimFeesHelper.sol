// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { IFeeDistributor } from "../interfaces/balancer/IFeeDistributor.sol";

/**
 * @title   ClaimFeesHelper
 * @author  ConvexFinance
 * @notice  Claim vecrv fees and distribute
 * @dev     Allows anyone to call `claimFees` that will basically collect any 3crv and distribute to cvxCrv
 *          via the booster.
 */
contract ClaimFeesHelper {
    IBooster public immutable booster;
    address public immutable voterProxy;

    mapping(address => uint256) public lastTokenTimes;
    IFeeDistributor public feeDistro;

    /**
     * @param _booster      Booster.sol, e.g. 0xF403C135812408BFbE8713b5A23a04b3D48AAE31
     * @param _voterProxy   CVX VoterProxy e.g. 0x989AEb4d175e16225E39E87d0D97A3360524AD80
     * @param _feeDistro    FeeDistro e.g. 0xD3cf852898b21fc233251427c2DC93d3d604F3BB
     */
    constructor(
        address _booster,
        address _voterProxy,
        address _feeDistro
    ) {
        booster = IBooster(_booster);
        voterProxy = _voterProxy;
        feeDistro = IFeeDistributor(_feeDistro);
    }

    /**
     * @dev Claims fees from fee claimer, and pings the booster to distribute.
     * @param _tokens Token address to claim fees for.
     * @param _checkpoints Number of checkpoints required previous to claim fees.
     */
    function claimFees(IERC20[] memory _tokens, uint256 _checkpoints) external {
        uint256 len = _tokens.length;
        require(len > 0, "!_tokens");

        // Checkpoint user n times before claiming fees
        for (uint256 i = 0; i < _checkpoints; i++) {
            feeDistro.checkpointUser(voterProxy);
        }

        for (uint256 i = 0; i < len; i++) {
            // Validate if the token should be claimed
            IERC20 token = _tokens[i];
            uint256 tokenTime = feeDistro.getTokenTimeCursor(token);
            require(tokenTime > lastTokenTimes[address(token)], "not time yet");

            IBooster.FeeDistro memory feeDist = booster.feeTokens(address(token));
            uint256 balanceBefore = token.balanceOf(feeDist.rewards);

            booster.earmarkFees(address(token));

            uint256 balanceAfter = token.balanceOf(feeDist.rewards);
            require((balanceAfter - balanceBefore) > 0, "nothing claimed");

            lastTokenTimes[address(token)] = tokenTime;
        }
    }
}
