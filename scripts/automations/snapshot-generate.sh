echo "Bash script to generate a snapshot"

echo $NODE_URL

# Determine the platform
PLATFORM=$(uname)

if [[ "$PLATFORM" == "Linux" ]]; then
  FIRST_THURSDAY=$(date -d '20241121' +'%Y-%m-%d')
  CURRENT_DATE=$(date +%Y-%m-%d)
  DAYS_DIFF=$(( ($(date -d "$CURRENT_DATE" +%s) - $(date -d "$FIRST_THURSDAY" +%s)) / 86400 ))
elif [[ "$PLATFORM" == "Darwin" ]]; then
  FIRST_THURSDAY=$(date -j -f '%Y%m%d' '20241121' +'%Y-%m-%d')
  CURRENT_DATE=$(date +%Y-%m-%d)
  DAYS_DIFF=$(( ($(date -j -f '%Y-%m-%d' "$CURRENT_DATE" +%s) - $(date -j -f '%Y-%m-%d' "$FIRST_THURSDAY" +%s)) / 86400 ))
else
  echo "Unsupported platform: $PLATFORM"
  exit 1
fi

echo $FIRST_THURSDAY
echo $CURRENT_DATE
echo $DAYS_DIFF

if (( DAYS_DIFF % 14 != 0 )); then
  echo "Not this Thursday. Exiting."
  exit 0
fi

yarn
yarn clean
yarn compile
yarn task snapshot:submit --network mainnet
RESULT=$?
echo $RESULT
if [ $RESULT -ne 0 ]; then
  echo "Failed to generate snapshot"
  exit 1
fi

yarn prettier

NOTIFICATION=$'Snapshot Gauge Votes proposal\r\n\nReview the latest pr at https://github.com/aurafinance/aura-contracts/pulls\r\n@phijfry, @Oxahtle7'
curl -s --data-urlencode "text=$NOTIFICATION" "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage?chat_id=$TELEGRAM_CHAT_ID" > /dev/null