#!/bin/bash
cd /home/z/my-project/upload/streamx-vercel
rm -rf .next dev.log
nohup npx next dev --webpack -p 3000 > dev.log 2>&1 &
echo $! > .server-pid
echo "Server started with PID $(cat .server-pid)"
