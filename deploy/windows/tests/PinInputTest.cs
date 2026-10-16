// Windows-only integration fixture. Compile with QLBS_Kiosk.cs and KIOSK_INPUT_TEST.
// The shipped EXE never includes this fixture or the no-network compilation symbol.
// Uses actual WH_KEYBOARD_LL, modal/owner windows, Win32 SendInput and production Tick.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace QLBS.Kiosk
{
    internal static class PinInputTests
    {
        [StructLayout(LayoutKind.Sequential)] private struct MouseInput
        {
            internal int X, Y;
            internal uint Data, Flags, Time;
            internal UIntPtr Extra;
        }
        [StructLayout(LayoutKind.Sequential)] private struct KeyboardInput
        {
            internal ushort Key, Scan;
            internal uint Flags, Time;
            internal UIntPtr Extra;
        }
        [StructLayout(LayoutKind.Explicit)] private struct InputUnion
        {
            [FieldOffset(0)] internal MouseInput Mouse;
            [FieldOffset(0)] internal KeyboardInput Keyboard;
        }
        [StructLayout(LayoutKind.Sequential)] private struct Input
        {
            internal uint Type;
            internal InputUnion Value;
        }
        [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
        [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetCursorPos(int x, int y);

        private static T Field<T>(object target, string name)
        {
            return (T)target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(target);
        }
        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
        private static void Send(Input[] inputs)
        {
            Check(SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) == inputs.Length,
                "SendInput failed; Windows desktop must be interactive. Error=" + Marshal.GetLastWin32Error());
        }
        private static void Chord(params int[] keys)
        {
            List<Input> inputs = new List<Input>();
            foreach (int key in keys) inputs.Add(new Input { Type = 1, Value = new InputUnion { Keyboard = new KeyboardInput { Key = (ushort)key } } });
            for (int i = keys.Length - 1; i >= 0; i--) inputs.Add(new Input { Type = 1, Value = new InputUnion { Keyboard = new KeyboardInput { Key = (ushort)keys[i], Flags = 2 } } });
            Send(inputs.ToArray());
        }
        private static void ClickSupport(LockForm owner)
        {
            float scale = Math.Min(owner.ClientSize.Width / 1366f, owner.ClientSize.Height / 768f);
            System.Drawing.Point point = owner.PointToScreen(new System.Drawing.Point(
                (int)((owner.ClientSize.Width - 1366 * scale) / 2 + 1218 * scale),
                (int)((owner.ClientSize.Height - 768 * scale) / 2 + 54 * scale)));
            Check(SetCursorPos(point.X, point.Y), "Cannot move fixture cursor");
            Send(new Input[] {
                new Input { Type = 0, Value = new InputUnion { Mouse = new MouseInput { Flags = 2 } } },
                new Input { Type = 0, Value = new InputUnion { Mouse = new MouseInput { Flags = 4 } } }
            });
        }
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length != 1) { Console.Error.WriteLine("Expected QA output directory"); return 2; }
            Directory.CreateDirectory(args[0]);
            Native.SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool originalNumLock = Control.IsKeyLocked(Keys.NumLock);
            string failure = null;
            int phase = 0, round = 0;
            Stopwatch elapsed = Stopwatch.StartNew();
            List<string> evidence = new List<string>();
            KioskConfig config = new KioskConfig { ServerUrl = "http://127.0.0.1:1", RoomCode = "PIN_FIXTURE", TerminalId = "fixture_pin_0123456789abcdef0123456789" };
            // KIOSK_INPUT_TEST disables ONLY network workers, not focus/timer/hooks/modal.
            using (KioskContext context = new KioskContext(config))
            using (System.Windows.Forms.Timer driver = new System.Windows.Forms.Timer())
            {
                driver.Interval = 300;
                driver.Tick += delegate
                {
                    try
                    {
                        Check(elapsed.ElapsedMilliseconds < 20000, "PIN input fixture timed out at phase " + phase + ", round " + round);
                        ItDialog pin = Field<ItDialog>(context, "itDialog");
                        LockForm owner = Field<List<LockForm>>(context, "windows")[0];
                        if (phase == 0)
                        {
                            phase = 1;
                            if (round == 0) ClickSupport(owner);
                            else Chord(0x11, 0x12, 0x10, 0x7B); // Ctrl+Alt+Shift+F12
                        }
                        else if (phase == 1)
                        {
                            if (pin == null || !pin.Visible || Native.GetForegroundWindow() != pin.Handle) return;
                            Check(Field<TextBox>(pin, "pin").Focused, "PIN textbox is not focused");
                            if (!Control.IsKeyLocked(Keys.NumLock)) Chord(0x90);
                            phase = 2;
                        }
                        else if (phase == 2)
                        {
                            Check(pin != null, "Modal disappeared before typing");
                            Chord(0x37); Chord(0x33); Chord(0x39); Chord(0x31); // top-row 7391
                            Chord(0x66); Chord(0x08); // Numpad 6 + Backspace
                            phase = 3;
                        }
                        else if (phase == 3)
                        {
                            Check(pin != null && Field<TextBox>(pin, "pin").Text == "7391", "Real keyboard digits/numpad/backspace did not reach the PIN textbox");
                            Chord(0x11, 0x41); Chord(0x34); Chord(0x32); // Ctrl+A replaces with 42
                            phase = 4;
                        }
                        else if (phase == 4)
                        {
                            Check(pin != null && Field<TextBox>(pin, "pin").Text == "42", "Ctrl+A or subsequent typing was lost");
                            Chord(0x5B, 0x44); Chord(0x12, 0x09); Chord(0x12, 0x73); // Win+D, Alt+Tab, Alt+F4
                            Chord(0x11, 0x10, 0x1B); Chord(0x11, 0x1B); // Ctrl+Shift+Esc, Ctrl+Esc
                            phase = 5;
                        }
                        else if (phase == 5)
                        {
                            Check(pin != null && pin.Visible && Native.GetForegroundWindow() == pin.Handle, "A forbidden shortcut escaped the PIN modal");
                            Check(Field<TextBox>(pin, "pin").Text == "42", "Blocked shortcuts changed PIN text");
                            // Check OS key-up balance: a fresh digit still arrives after the shortcuts.
                            Chord(0x35); phase = 6;
                        }
                        else if (phase == 6)
                        {
                            Check(pin != null && Field<TextBox>(pin, "pin").Text == "425", "A modifier remained stuck after blocked shortcuts");
                            evidence.Add((round == 0 ? "Mouse IT button" : "Ctrl+Alt+Shift+F12") + ": real PIN typing/numpad/backspace/Ctrl+A passed; system escapes blocked; modifiers released.");
                            phase = 7; pin.Close();
                        }
                        else if (phase == 7 && pin == null)
                        {
                            if (++round < 2) phase = 0;
                            else { driver.Stop(); context.ExitThread(); }
                        }
                    }
                    catch (Exception ex)
                    {
                        failure = ex.ToString(); driver.Stop(); context.ExitThread();
                    }
                };
                driver.Start();
                Application.Run(context);
            }
            if (Control.IsKeyLocked(Keys.NumLock) != originalNumLock) Chord(0x90);
            if (failure != null || round != 2)
            {
                string error = failure ?? "Fixture exited without completing both opening paths";
                File.WriteAllText(Path.Combine(args[0], "pin-input.txt"), error);
                Console.Error.WriteLine(error); return 1;
            }
            Check(Application.OpenForms.Count == 0, "Fixture left a kiosk/modal window open");
            evidence.Add("Production KioskContext exited; windows/hooks disposed. No API call, registry edit, installation or real PIN submitted.");
            File.WriteAllLines(Path.Combine(args[0], "pin-input.txt"), evidence.ToArray());
            Console.WriteLine(String.Join(Environment.NewLine, evidence.ToArray()));
            return 0;
        }
    }
}
