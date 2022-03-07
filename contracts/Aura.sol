// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts-0.8/utils/Address.sol";
// import { SafeMath } from "@openzeppelin/contracts-0.8/utils/math/SafeMath.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import "hardhat/console.sol";
import { AuraMath, AuraMath128, AuraMath64, AuraMath32, AuraMath112, AuraMath224 } from "./AuraMath.sol";

interface IStaker {
    function operator() external view returns (address);
}

/**
 * @title   AuraToken
 * @author  ConvexFinance
 * @notice  Basically an ERC20 with minting functionality operated by the "operator" of the VoterProxy (Booster).
 * @dev     The minting schedule is based on the amount of CRV earned through staking and is
 *          distirbuted along a supply curve (cliffs etc). Fork of ConvexToken.
 */
contract AuraToken is ERC20, Ownable {
    using SafeERC20 for IERC20;
    using Address for address;
    using AuraMath for uint256;

    address public operator;
    address public immutable vecrvProxy;

    uint256 public constant maxSupply = 100 * 1000000 * 1e18; //100mil
    uint256 public constant totalCliffs = 1000;
    uint256 public immutable reductionPerCliff;

    /* ========== EVENTS ========== */
    event OperatorChanged(address indexed previousOperator, address indexed newOperator);

    /**
     * @param _proxy        CVX VoterProxy
     * @param _nameArg      Token name
     * @param _symbolArg    Token symbol
     */
    constructor(
        address _proxy,
        string memory _nameArg,
        string memory _symbolArg
    ) ERC20(_nameArg, _symbolArg) Ownable() {
        operator = msg.sender;
        vecrvProxy = _proxy;
        reductionPerCliff = maxSupply.div(totalCliffs);
    }

    /**
     * @dev This can be called if the operator of the voterProxy somehow changes.
     */
    function updateOperator() public {
        _setOperator(IStaker(vecrvProxy).operator());
    }

    /**
     * @dev Updates the operator.
     */
    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "invalid operator");
        _setOperator(_operator);
    }

    /**
     * @dev Updates the operator.
     */
    function _setOperator(address _operator) internal {
        emit OperatorChanged(operator, _operator);
        operator = _operator;
    }

    /**
     * @dev Mints CVX to a given user based on current supply and schedule.
     */
    function mint(address _to, uint256 _amount) external {
        console.log("SOL:mint _to %s _amount %s", _to, _amount);
        // console.log("SOL:mint msg.sender %s operator %s", msg.sender, operator);
        if (msg.sender != operator) {
            //dont error just return. if a shutdown happens, rewards on old system
            //can still be claimed, just wont mint cvx
            return;
        }

        uint256 supply = totalSupply();
        console.log("SOL:mint supply %s", supply);
        if (supply == 0) {
            //premine, one time only
            _mint(_to, _amount);
            //automatically switch operators
            updateOperator();
            return;
        }

        //use current supply to gauge cliff
        //this will cause a bit of overflow into the next cliff range
        //but should be within reasonable levels.
        //requires a max supply check though
        uint256 cliff = supply.div(reductionPerCliff);
        //mint if below total cliffs

        console.log("SOL:mint cliff %s,totalCliffs %s, reductionPerCliff %s", cliff, totalCliffs, reductionPerCliff);
        if (cliff < totalCliffs) {
            //for reduction% take inverse of current cliff
            uint256 reduction = totalCliffs.sub(cliff);
            //reduce
            _amount = _amount.mul(reduction).div(totalCliffs);

            //supply cap check
            uint256 amtTillMax = maxSupply.sub(supply);
            if (_amount > amtTillMax) {
                _amount = amtTillMax;
            }
            console.log("SOL:mint reduction %s,_amount %s, amtTillMax %s", reduction, _amount, amtTillMax);

            //mint
            _mint(_to, _amount);
        }
    }
}
