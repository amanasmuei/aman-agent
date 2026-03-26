# aman-agent v0.6.0 — Professional Demo
# Two scenes: "First Run" + "Returning User"
#
# Record: vhs docs/demo/demo.tape

Output docs/demo/demo.gif
Output docs/demo/demo.mp4

Set Shell "bash"
Set FontSize 18
Set Width 1100
Set Height 650
Set Padding 20
Set TypingSpeed 40ms
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set WindowBarSize 40
Set BorderRadius 8
Set Framerate 30
Set LoopOffset 0%
Set MarginFill "#1e1e2e"
Set Margin 20

# Use our demo runner script
Hide
Type "bash docs/demo/demo-script.sh"
Enter
Sleep 1s
Show

Sleep 60s
