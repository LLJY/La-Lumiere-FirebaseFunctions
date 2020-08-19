export GOOGLE_APPLICATION_CREDENTIALS="/home/lucas/projects/MBAP/La-Lumiere-FirebaseFunctions/firebasecfg.json"   
npm --prefix ./functions/ run build
firebase serve --only functions --port=9000
