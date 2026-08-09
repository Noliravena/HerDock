package shell

import (
	"bufio"
	"context"
	"io"
	"os/exec"
	"runtime"
	"sync"
	"time"
)

type Output struct {
	Stream string // stdout | stderr
	Text   string
}

type Result struct {
	ExitCode   int
	DurationMs int64
}

// Run streams stdout/stderr lines via onLine and returns exit code.
func Run(ctx context.Context, cwd, command string, onLine func(Output)) (Result, error) {
	start := time.Now()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", command)
	} else {
		cmd = exec.CommandContext(ctx, "bash", "-lc", command)
	}
	cmd.Dir = cwd

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return Result{}, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return Result{}, err
	}
	if err := cmd.Start(); err != nil {
		return Result{}, err
	}

	var wg sync.WaitGroup
	pump := func(r io.Reader, stream string) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			if onLine != nil {
				onLine(Output{Stream: stream, Text: sc.Text() + "\n"})
			}
		}
	}
	wg.Add(2)
	go pump(stdout, "stdout")
	go pump(stderr, "stderr")
	wg.Wait()

	err = cmd.Wait()
	code := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
			err = nil
		} else {
			return Result{DurationMs: time.Since(start).Milliseconds()}, err
		}
	}
	return Result{ExitCode: code, DurationMs: time.Since(start).Milliseconds()}, nil
}
