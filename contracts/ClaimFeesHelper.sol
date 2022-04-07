// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

interface IFeeClaim {
    function claim(address) external;

    function last_token_time() external view returns (uint256);

    function token() external view returns (address);
}

interface IBooster {
    function earmarkFees(address _feeDistro) external returns (bool);
}

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

    struct Distro {
        IERC20 feeToken;
        uint256 lastTokenTime;
    }
    mapping(address => Distro) public feeDistros;

    /**
     * @param _booster      Booster.sol, e.g. 0xF403C135812408BFbE8713b5A23a04b3D48AAE31
     * @param _voterProxy   CVX VoterProxy e.g. 0x989AEb4d175e16225E39E87d0D97A3360524AD80
     * @param _feeDistros   FeeDistro array e.g. 0xA464e6DCda8AC41e03616F95f4BC98a13b8922Dc
     */
    constructor(
        address _booster,
        address _voterProxy,
        address[] memory _feeDistros
    ) {
        booster = IBooster(_booster);
        voterProxy = _voterProxy;

        for (uint256 i = 0; i < _feeDistros.length; i++) {
            address distro = _feeDistros[i];
            feeDistros[distro] = Distro(IERC20(IFeeClaim(distro).token()), 0);
        }
    }

    /**
     * @dev Claims fees from fee claimer, and pings the booster to distribute
     */
    function claimFees(address _distro) external {
        Distro storage distro = feeDistros[_distro];

        uint256 tokenTime = IFeeClaim(_distro).last_token_time();
        require(tokenTime > distro.lastTokenTime, "not time yet");
        uint256 bal = distro.feeToken.balanceOf(voterProxy);
        IFeeClaim(_distro).claim(voterProxy);

        while (distro.feeToken.balanceOf(voterProxy) <= bal) {
            IFeeClaim(_distro).claim(voterProxy);
        }

        booster.earmarkFees(_distro);
        distro.lastTokenTime = tokenTime;
    }
}
