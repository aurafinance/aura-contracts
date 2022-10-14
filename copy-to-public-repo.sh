if [ -z "$1" ]
  then
    echo "[!] argument missing"
    echo "Usage: ./copy-to-public-repo.sh ./path/to/copy/to"
    exit;
fi

repo_directory=$1

if [ ! -d "$repo_directory" ]
then 
  echo "[!] directory $repo_directory does not exist"
  echo "[*] creating directory $repo_directory"
  mkdir -p $repo_directory;
fi

echo "[*] creating internal directory structure";

find . -name "*.sol" \
  -not -path "./node_modules/*" \
  -not -path "./convex-platform/*" \
  -not -path "./artifacts/*" \
  -not -path "./contracts/_mocks/*" \
  | xargs dirname | sed "s/^\.//g" | xargs -I{} mkdir -p "$repo_directory{}"

echo "[*] copying files to $repo_directory";

find . -name "*.sol" \
  -not -path "./node_modules/*" \
  -not -path "./convex-platform/*" \
  -not -path "./artifacts/*" \
  -not -path "./contracts/_mocks/*" \
  | xargs -I{} echo "{}" | sed "s/^\.//g" | xargs -I{} cp ".{}" "$repo_directory{}" 


echo "[*] copy complete"
