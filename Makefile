

ZIP_FILE:=~/Downloads/beekeeper_simulator_by_kelly.zip
update:
	unzip -o ${ZIP_FILE}
	rm ${ZIP_FILE}
	git commit -am"WebSim Update"
	git push
